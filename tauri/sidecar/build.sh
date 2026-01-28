#!/bin/bash
# Build the Oracle sidecar executable for both architectures (macOS)
set -e
cd "$(dirname "$0")"

# Build for native architecture (arm64 on Apple Silicon)
echo "=== Building sidecar for native architecture ==="
source venv/bin/activate
python build_sidecar.py

# Build for x86_64 using Rosetta (only on macOS ARM)
if [[ "$(uname)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  echo ""
  echo "=== Building sidecar for x86_64 (via Rosetta) ==="
  
  # Check if x86_64 venv exists, create if not
  if [[ ! -d "venv-x64" ]]; then
    echo "Creating x86_64 Python virtual environment..."
    arch -x86_64 /usr/bin/python3 -m venv venv-x64
    arch -x86_64 ./venv-x64/bin/pip install --upgrade pip
    arch -x86_64 ./venv-x64/bin/pip install -r requirements.txt
    arch -x86_64 ./venv-x64/bin/pip install pyinstaller
  fi
  
  # Build using x86_64 Python
  arch -x86_64 ./venv-x64/bin/python build_sidecar.py
fi

echo ""
echo "=== Sidecar build complete ==="
