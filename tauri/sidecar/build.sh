#!/bin/bash
# Build the Oracle sidecar executable for both architectures (macOS)
set -e
cd "$(dirname "$0")"

# Build for native architecture (arm64 on Apple Silicon)
echo "=== Building sidecar for native architecture ==="
if [[ ! -x "venv/bin/python3" && ! -x "venv/bin/python" ]]; then
  echo "Missing native sidecar Python environment. Prepare tauri/sidecar/venv manually before building." >&2
  exit 1
fi

PYTHON_BIN="./venv/bin/python3"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="./venv/bin/python"
fi
"$PYTHON_BIN" build_sidecar.py

# Build for x86_64 using Rosetta (only on macOS ARM)
if [[ "$(uname)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  echo ""
  echo "=== Building sidecar for x86_64 (via Rosetta) ==="
  
  # Check if x86_64 venv exists, create if not
  if [[ ! -d "venv-x64" ]]; then
    echo "Missing x86_64 sidecar Python environment. Prepare tauri/sidecar/venv-x64 manually before building." >&2
    exit 1
  fi
  
  # Build using x86_64 Python
  arch -x86_64 ./venv-x64/bin/python build_sidecar.py
fi

# Tauri's dev runner launches the external binary from tauri/. Its PyInstaller
# support files must sit beside that executable. Release bundles copy only the
# support directory for their target architecture via a Tauri config overlay.
NATIVE_TRIPLE="$("$PYTHON_BIN" -c 'from build_sidecar import get_target_triple; print(get_target_triple())')"
ln -sfn "sidecar-dist/oracle-sidecar-$NATIVE_TRIPLE/_internal" ../_internal

# Tauri copies the external binary into target/debug for `tauri dev`. The
# one-directory PyInstaller bootloader looks for _internal beside that copy.
mkdir -p ../target/debug
if [[ -e ../target/debug/_internal && ! -L ../target/debug/_internal ]]; then
  echo "Refusing to replace non-symlink tauri/target/debug/_internal" >&2
  exit 1
fi
ln -sfn "../../sidecar-dist/oracle-sidecar-$NATIVE_TRIPLE/_internal" ../target/debug/_internal

echo ""
echo "=== Sidecar build complete ==="
