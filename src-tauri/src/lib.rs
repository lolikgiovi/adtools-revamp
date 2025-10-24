#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      set_jenkins_username,
      set_jenkins_token,
      has_jenkins_token,
      jenkins_get_env_choices,
      jenkins_trigger_job,
      jenkins_poll_queue_for_build,
      jenkins_stream_logs
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
use keyring::Entry;
use reqwest::{Client, StatusCode};
use serde::{Deserialize};
use std::time::Duration;
use tauri::AppHandle;

const KEYCHAIN_SERVICE: &str = "ad-tools:jenkins";

fn http_client() -> Client {
  Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .expect("failed to build reqwest client")
}

async fn load_credentials() -> Result<(String, String), String> {
  let user_entry = Entry::new(KEYCHAIN_SERVICE, "__username__");
  let username = user_entry.get_password().map_err(|e| e.to_string())?;
  let token = Entry::new(KEYCHAIN_SERVICE, &username).get_password().map_err(|e| e.to_string())?;
  Ok((username, token))
}

#[tauri::command]
pub fn set_jenkins_username(username: String) -> Result<(), String> {
  Entry::new(KEYCHAIN_SERVICE, "__username__").set_password(&username).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_jenkins_token(token: String) -> Result<(), String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__");
  let username = entry.get_password().map_err(|e| e.to_string())?;
  Entry::new(KEYCHAIN_SERVICE, &username).set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_jenkins_token() -> Result<bool, String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__");
  let username = match entry.get_password() { Ok(u) => u, Err(_) => return Ok(false) };
  match Entry::new(KEYCHAIN_SERVICE, &username).get_password() { Ok(_) => Ok(true), Err(_) => Ok(false) }
}

#[derive(Deserialize)]
struct JobInfo { property: Option<Vec<JobProperty>> }

#[derive(Deserialize)]
struct JobProperty { #[serde(default)] parameterDefinitions: Vec<JobParamDefinition> }

#[derive(Deserialize)]
#[serde(tag = "_class")]
enum JobParamDefinition {
  #[serde(rename = "hudson.model.ChoiceParameterDefinition")]
  Choice { name: String, #[serde(default)] choices: Vec<String> },
  #[serde(other)] Other,
}

#[tauri::command]
pub async fn jenkins_get_env_choices(base_url: String, job: String) -> Result<Vec<String>, String> {
  let (username, token) = load_credentials().await?;
  let client = http_client();
  let url = format!("{}/job/{}/api/json", base_url.trim_end_matches('/'), job);
  let res = client.get(&url).basic_auth(username, Some(token)).send().await.map_err(|e| e.to_string())?;
  if !res.status().is_success() { return Err(format!("HTTP {}", res.status())); }
  let info: JobInfo = res.json().await.map_err(|e| e.to_string())?;
  let mut env_choices = vec![];
  if let Some(props) = info.property { for p in props { for def in p.parameterDefinitions { if let JobParamDefinition::Choice { name, choices } = def { if name == "ENV" { env_choices = choices; } } } } }
  Ok(env_choices)
}

#[tauri::command]
pub async fn jenkins_trigger_job(base_url: String, job: String, env: String, sql_text: String) -> Result<String, String> {
  let lowered = sql_text.to_lowercase();
  for kw in ["insert","update","delete","alter","drop","truncate"] { if lowered.contains(kw) { return Err("SQL contains forbidden statements".into()); } }

  let (username, token) = load_credentials().await?;
  let client = http_client();

  let file_part = reqwest::multipart::Part::bytes(sql_text.into_bytes()).file_name("query.sql").mime_str("application/sql").unwrap();
  let form = reqwest::multipart::Form::new().text("ENV", env).part("INPUT_FILE", file_part);

  let base = base_url.trim_end_matches('/');
  let url = format!("{}/job/{}/buildWithParameters", base, job);
  let mut req = client.post(&url).basic_auth(&username, Some(&token)).multipart(form);

  // Try crumb issuer; ignore failures
  let crumb_url = format!("{}/crumbIssuer/api/json", base);
  if let Ok(r) = client.get(&crumb_url).basic_auth(&username, Some(&token)).send().await {
    if r.status().is_success() {
      if let Ok(v) = r.json::<serde_json::Value>().await {
        if let (Some(field), Some(crumb)) = (v.get("crumbRequestField").and_then(|x| x.as_str()), v.get("crumb").and_then(|x| x.as_str())) {
          req = req.header(field, crumb);
        }
      }
    }
  }

  let res = req.send().await.map_err(|e| e.to_string())?;
  if res.status() != StatusCode::CREATED { return Err(format!("Trigger failed: HTTP {}", res.status())); }
  let loc = res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or_else(|| "Missing Location header".to_string())?;
  let q = format!("{}api/json", loc.trim_end_matches('/'));
  Ok(q)
}

#[tauri::command]
pub async fn jenkins_poll_queue_for_build(_base_url: String, queue_url: String) -> Result<(Option<u64>, Option<String>), String> {
  let (username, token) = load_credentials().await?;
  let client = http_client();
  let res = client.get(&queue_url).basic_auth(username, Some(token)).send().await.map_err(|e| e.to_string())?;
  if !res.status().is_success() { return Err(format!("HTTP {}", res.status())); }
  let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
  let build_number = v.get("executable").and_then(|e| e.get("number")).and_then(|n| n.as_u64());
  let executable_url = v.get("executable").and_then(|e| e.get("url")).and_then(|u| u.as_str()).map(|s| s.to_string());
  Ok((build_number, executable_url))
}

#[tauri::command]
pub async fn jenkins_stream_logs(app: AppHandle, base_url: String, job: String, build_number: u64) -> Result<(), String> {
  let (username, token) = load_credentials().await?;
  let client = http_client();

  tauri::async_runtime::spawn(async move {
    let base = base_url.trim_end_matches('/');
    let mut start: u64 = 0;
    loop {
      let url = format!("{}/job/{}/{}/logText/progressiveText?start={}", base, job, build_number, start);
      let req = client.get(&url).basic_auth(&username, Some(&token));
      let res = match req.send().await { Ok(r) => r, Err(e) => { let _ = app.emit("jenkins:log-error", format!("{}", e)); break; } };
      if !res.status().is_success() { let _ = app.emit("jenkins:log-error", format!("HTTP {}", res.status())); break; }
      let headers = res.headers().clone();
      let text = match res.text().await { Ok(t) => t, Err(e) => { let _ = app.emit("jenkins:log-error", format!("{}", e)); break; } };
      let next = headers.get("X-Text-Size").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(start);
      let more = headers.get("X-More-Data").and_then(|v| v.to_str().ok()).map(|s| s == "true").unwrap_or(false);
      let _ = app.emit("jenkins:log", serde_json::json!({ "chunk": text, "next_offset": next, "more": more }));
      if !more { let _ = app.emit("jenkins:log-complete", serde_json::json!({ "build_number": build_number })); break; }
      start = next;
      tauri::async_runtime::sleep(Duration::from_millis(800)).await;
    }
  });

  Ok(())
}