// Decide whether the updater can replace this app bundle in place, and move it to ~/apps when it can't.
//
// The updater plugin renames the running bundle into $TMPDIR. When that rename fails with a permission error
// it escalates through `osascript ... with administrator privileges`, which users without admin can't pass and
// which XDR tooling treats as suspicious. These checks are read-only so they don't trip XDR either.
//
// Ways the check can be wrong, and what covers each:
// - Not running from a .app (cargo dev run)            -> never ask to move.
// - Already running from ~/apps                         -> never ask to move (no relocation loop).
// - Gatekeeper-translocated read-only copy               -> move (path contains /AppTranslocation/).
// - Read-only volume (mounted DMG)                       -> move (access() reports EROFS).
// - Bundle dir not writable (root-owned, chmod 555)      -> move (moving a dir to a new parent rewrites its "..").
// - Parent dir not writable                              -> move.
// - macOS privacy block on the parent (e.g. ~/Documents) -> move (listing the parent fails with EPERM).
// - Everything writable                                  -> update in place as before.

use serde::Serialize;
use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const USER_APPS_DIR: &str = "apps";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallLocation {
  pub needs_move: bool,
  pub reason: Option<&'static str>,
  pub current_path: Option<String>,
  pub target_path: Option<String>,
}

fn current_bundle() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf)
}

fn home_dir() -> Option<PathBuf> {
  std::env::var_os("HOME").map(PathBuf::from)
}

fn user_apps_target(home: &Path, bundle: &Path) -> Option<PathBuf> {
  Some(home.join(USER_APPS_DIR).join(bundle.file_name()?))
}

// Read-only writability check: access() honours groups, ACLs and read-only mounts without touching anything.
fn writable(path: &Path) -> Result<(), std::io::Error> {
  let c = CString::new(path.as_os_str().as_bytes()).map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
  if unsafe { libc::access(c.as_ptr(), libc::W_OK) } == 0 {
    Ok(())
  } else {
    Err(std::io::Error::last_os_error())
  }
}

pub fn check_bundle(bundle: Option<&Path>, home: Option<&Path>) -> InstallLocation {
  let none = |current: Option<&Path>, target: Option<&Path>, reason: Option<&'static str>| InstallLocation {
    needs_move: reason.is_some(),
    reason,
    current_path: current.map(|p| p.display().to_string()),
    target_path: target.map(|p| p.display().to_string()),
  };
  let (Some(bundle), Some(home)) = (bundle, home) else {
    return none(bundle, None, None);
  };
  let Some(target) = user_apps_target(home, bundle) else {
    return none(Some(bundle), None, None);
  };
  if bundle == target {
    return none(Some(bundle), Some(&target), None);
  }
  if bundle.to_string_lossy().contains("/AppTranslocation/") {
    return none(Some(bundle), Some(&target), Some("translocated"));
  }
  let Some(parent) = bundle.parent() else {
    return none(Some(bundle), Some(&target), None);
  };
  for path in [parent, bundle] {
    if let Err(err) = writable(path) {
      let reason = if err.raw_os_error() == Some(libc::EROFS) { "read-only" } else { "no-permission" };
      return none(Some(bundle), Some(&target), Some(reason));
    }
  }
  if let Err(err) = std::fs::read_dir(parent) {
    if err.raw_os_error() == Some(libc::EPERM) {
      return none(Some(bundle), Some(&target), Some("privacy"));
    }
  }
  none(Some(bundle), Some(&target), None)
}

#[tauri::command]
pub fn install_location_check() -> InstallLocation {
  check_bundle(current_bundle().as_deref(), home_dir().as_deref())
}

// Copy the running bundle to ~/apps (unless a copy is already there), open it, and quit this one.
// Staging into a hidden sibling means ~/apps never holds a half-copied app.
#[tauri::command]
pub fn move_install_to_user_apps(app: tauri::AppHandle) -> Result<String, String> {
  let bundle = current_bundle().ok_or("AD Tools isn't running from an app bundle")?;
  let home = home_dir().ok_or("Home folder not found")?;
  let target = user_apps_target(&home, &bundle).ok_or("App bundle has no name")?;
  if bundle == target {
    return Err("AD Tools is already in ~/apps".into());
  }
  let dir = target.parent().ok_or("Invalid target folder")?;
  std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;

  if !target.exists() {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let staging = dir.join(format!(".{name}.partial"));
    let _ = std::fs::remove_dir_all(&staging);
    let copied = Command::new("/usr/bin/ditto").arg(&bundle).arg(&staging).status();
    if !copied.as_ref().is_ok_and(|s| s.success()) {
      let _ = std::fs::remove_dir_all(&staging);
      return Err(format!("Couldn't copy AD Tools to {}", target.display()));
    }
    std::fs::rename(&staging, &target).map_err(|e| {
      let _ = std::fs::remove_dir_all(&staging);
      format!("Couldn't finish moving AD Tools to {}: {e}", target.display())
    })?;
  }

  Command::new("/usr/bin/open")
    .arg("-n")
    .arg(&target)
    .spawn()
    .map_err(|e| format!("Couldn't open {}: {e}", target.display()))?;

  // Let the command reply reach the WebView before quitting.
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(300));
    app.exit(0);
  });
  Ok(target.display().to_string())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::os::unix::fs::PermissionsExt;

  struct Sandbox(PathBuf);
  impl Sandbox {
    fn new(tag: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("adtools-install-{tag}-{}", std::process::id()));
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      Sandbox(dir)
    }
    fn bundle_in(&self, rel: &str) -> PathBuf {
      let b = self.0.join(rel).join("AD Tools.app");
      std::fs::create_dir_all(b.join("Contents/MacOS")).unwrap();
      b
    }
  }
  impl Drop for Sandbox {
    fn drop(&mut self) {
      for entry in walk(&self.0) {
        let _ = std::fs::set_permissions(&entry, std::fs::Permissions::from_mode(0o755));
      }
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }
  fn walk(p: &Path) -> Vec<PathBuf> {
    let mut out = vec![p.to_path_buf()];
    if let Ok(rd) = std::fs::read_dir(p) {
      for e in rd.flatten() {
        out.extend(walk(&e.path()));
      }
    }
    out
  }
  fn chmod(p: &Path, mode: u32) {
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode)).unwrap();
  }

  #[test]
  fn dev_run_without_bundle_never_moves() {
    let r = check_bundle(None, Some(Path::new("/Users/x")));
    assert!(!r.needs_move);
  }

  #[test]
  fn writable_location_updates_in_place() {
    let s = Sandbox::new("ok");
    let b = s.bundle_in("Documents");
    let r = check_bundle(Some(&b), Some(&s.0));
    assert_eq!(r.reason, None);
    assert!(!r.needs_move);
    assert_eq!(r.target_path, Some(s.0.join("apps/AD Tools.app").display().to_string()));
  }

  #[test]
  fn already_in_user_apps_never_moves_even_if_locked() {
    let s = Sandbox::new("home");
    let b = s.bundle_in("apps");
    chmod(&b, 0o555);
    let r = check_bundle(Some(&b), Some(&s.0));
    assert!(!r.needs_move);
  }

  #[test]
  fn translocated_copy_moves() {
    let b = PathBuf::from("/private/var/folders/x/T/AppTranslocation/ABC/d/AD Tools.app");
    let r = check_bundle(Some(&b), Some(Path::new("/Users/x")));
    assert_eq!(r.reason, Some("translocated"));
  }

  #[test]
  fn locked_bundle_dir_moves() {
    let s = Sandbox::new("bundle");
    let b = s.bundle_in("Documents");
    chmod(&b, 0o555);
    let r = check_bundle(Some(&b), Some(&s.0));
    assert_eq!(r.reason, Some("no-permission"));
  }

  #[test]
  fn locked_parent_dir_moves() {
    let s = Sandbox::new("parent");
    let b = s.bundle_in("Documents");
    chmod(b.parent().unwrap(), 0o555);
    let r = check_bundle(Some(&b), Some(&s.0));
    assert_eq!(r.reason, Some("no-permission"));
  }

  #[test]
  fn check_does_not_touch_the_bundle() {
    let s = Sandbox::new("readonly-check");
    let b = s.bundle_in("Documents");
    let before: Vec<_> = walk(&s.0);
    let _ = check_bundle(Some(&b), Some(&s.0));
    assert_eq!(before, walk(&s.0));
    assert!(!s.0.join("apps").exists());
  }
}
