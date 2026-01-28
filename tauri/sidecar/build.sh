#!/bin/bash
# Build the Oracle sidecar executable
cd "$(dirname "$0")"
source venv/bin/activate
python build_sidecar.py
