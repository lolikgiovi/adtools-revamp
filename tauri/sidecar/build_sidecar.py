#!/usr/bin/env python3
"""
Build script to create the Oracle sidecar executable using PyInstaller.
The output is placed in tauri/binaries/ with the correct target triple suffix.
"""

import subprocess
import platform
import sys
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
    binaries_dir = project_root / "binaries"

    # Ensure binaries directory exists
    binaries_dir.mkdir(exist_ok=True)

    target_triple = get_target_triple()
    output_name = f"oracle-sidecar-{target_triple}"

    if platform.system() == "Windows":
        output_name += ".exe"

    print(f"Building Oracle sidecar for: {target_triple}")
    print(f"Output: {binaries_dir / output_name}")

    # Build with PyInstaller
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", output_name.replace(".exe", ""),  # PyInstaller adds .exe on Windows
        "--distpath", str(binaries_dir),
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
        str(script_dir / "oracle_sidecar.py"),
    ]

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=script_dir)

    if result.returncode != 0:
        print("❌ Build failed!")
        sys.exit(1)

    output_path = binaries_dir / output_name
    if output_path.exists():
        print(f"✅ Build successful: {output_path}")
        print(f"   Size: {output_path.stat().st_size / 1024 / 1024:.1f} MB")
    else:
        print("❌ Output file not found!")
        sys.exit(1)


if __name__ == "__main__":
    main()
