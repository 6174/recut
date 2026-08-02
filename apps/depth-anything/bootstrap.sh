#!/bin/sh
# [INPUT]: RECUT_MODELS_DIR supplied by the platform Python runtime
# [OUTPUT]: prepares the official Depth Anything V2 source in the shared model namespace
# [POS]: permissive App fallback setup; the platform owns venv and pip lifecycle
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
set -eu

DEPTH_ROOT="$RECUT_MODELS_DIR/depth-anything-v2"
REPOSITORY="$DEPTH_ROOT/repository"
mkdir -p "$DEPTH_ROOT"

if [ ! -d "$REPOSITORY/.git" ]; then
  rm -rf "$REPOSITORY"
  git clone --depth 1 https://github.com/DepthAnything/Depth-Anything-V2.git "$REPOSITORY"
fi
