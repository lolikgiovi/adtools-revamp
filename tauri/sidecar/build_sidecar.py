#!/usr/bin/env python3
"""Build a fast-starting Oracle sidecar and its support files with PyInstaller."""

import subprocess
import platform
import sys
import os
import shutil
from pathlib import Path


def get_target_triple() -> str:
    """Get the Rust-style target triple for the current platform."""
    machine = platform.machine().lower()
    system = platform.system().lower()

    if system == "darwin":
        if machine == "arm64":
            return "aarch64-apple-darwin"
        else:
            return "x86_64-apple-darwin"
    elif system == "windows":
        if machine == "amd64" or machine == "x86_64":
            return "x86_64-pc-windows-msvc"
        else:
            return "i686-pc-windows-msvc"
    elif system == "linux":
        if machine == "x86_64":
            return "x86_64-unknown-linux-gnu"
        elif machine == "aarch64":
            return "aarch64-unknown-linux-gnu"
        else:
            return f"{machine}-unknown-linux-gnu"
    else:
        raise RuntimeError(f"Unsupported platform: {system} {machine}")


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent  # tauri/
    binaries_dir = project_root
    sidecar_dist = project_root / "sidecar-dist"

    target_triple = get_target_triple()
    output_name = f"oracle-sidecar-{target_triple}"

    if platform.system() == "Windows":
        output_name += ".exe"

    print(f"Building Oracle sidecar for: {target_triple}")
    print(f"Output: {sidecar_dist / output_name}")

    # Build with PyInstaller
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onedir",
        "--contents-directory", "_internal",
        "--name", output_name.replace(".exe", ""),  # PyInstaller adds .exe on Windows
        "--distpath", str(sidecar_dist),
        "--workpath", str(script_dir / "build"),
        "--specpath", str(script_dir),
        "--clean",
        "--noconfirm",
        # Hidden imports that PyInstaller might miss
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        # Cryptography is required by oracledb thin mode
        "--hidden-import", "cryptography",
        "--hidden-import", "cryptography.hazmat.primitives.ciphers",
        "--hidden-import", "cryptography.hazmat.primitives.ciphers.algorithms",
        "--hidden-import", "cryptography.hazmat.primitives.ciphers.modes",
        "--hidden-import", "cryptography.hazmat.backends",
        "--hidden-import", "cryptography.hazmat.backends.openssl",
        "--collect-all", "cryptography",
        str(script_dir / "oracle_sidecar.py"),
    ]

    print(f"Running: {' '.join(cmd)}")
    env = os.environ.copy()
    # Keep PyInstaller cache inside the project so sandboxed/local builds do not
    # need to touch ~/Library/Application Support/pyinstaller.
    env.setdefault("PYINSTALLER_CONFIG_DIR", str(script_dir / "build" / "pyinstaller-cache"))
    result = subprocess.run(cmd, cwd=script_dir, env=env)

    if result.returncode != 0:
        print("❌ Build failed!")
        sys.exit(1)

    output_path = sidecar_dist / output_name.replace(".exe", "") / output_name
    if output_path.exists():
        shutil.copy2(output_path, binaries_dir / output_name)
        print(f"✅ Build successful: {output_path}")
        print(f"   Bundle size: {sum(p.stat().st_size for p in output_path.parent.rglob('*') if p.is_file()) / 1024 / 1024:.1f} MB")

        # The framework remains signed inside the app's bundled sidecar
        # resources, which the PyInstaller bootloader reaches via Frameworks.
        if platform.system() == "Darwin":
            framework = output_path.parent / "_internal" / "Python3.framework"
            framework_sign = subprocess.run(
                ["codesign", "--force", "--deep", "--sign", "-", str(framework)],
                capture_output=True,
                text=True,
            )
            if framework_sign.returncode != 0:
                print(f"❌ Framework signing failed: {framework_sign.stderr}")
                sys.exit(1)
            print("🔏 Ad-hoc signing for macOS...")
            sign_result = subprocess.run(
                ["codesign", "--force", "--sign", "-", str(binaries_dir / output_name)],
                capture_output=True,
                text=True
            )
            if sign_result.returncode == 0:
                print("✅ Ad-hoc signing successful")
            else:
                print(f"❌ Executable signing failed: {sign_result.stderr}")
                sys.exit(1)
    else:
        print("❌ Output file not found!")
        sys.exit(1)


if __name__ == "__main__":
    main()
