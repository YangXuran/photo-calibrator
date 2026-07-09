#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

export PYINSTALLER_CONFIG_DIR="${PYINSTALLER_CONFIG_DIR:-build/pyinstaller-config}"

if [ -x ".venv/bin/pyinstaller" ]; then
  .venv/bin/pyinstaller \
    --clean \
    --noconfirm \
    --distpath build/backend \
    --workpath build/pyinstaller \
    packaging/photo-calibrator-backend.spec
else
  "${PYTHON:-python}" -m PyInstaller \
    --clean \
    --noconfirm \
    --distpath build/backend \
    --workpath build/pyinstaller \
    packaging/photo-calibrator-backend.spec
fi
