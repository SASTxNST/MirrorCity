#!/usr/bin/env bash
# Builds lib/swmm-engine/swmm.mjs: EPA SWMM compiled to WebAssembly (wasm
# embedded in the module, runs in browsers and Node). The output is committed,
# so only rerun this to change versions or flags.
#
#   scripts/build-swmm-wasm.sh
#
# Needs git and python3. Emscripten is installed outside the repo, in
# $EMSDK_DIR (default ~/.cache/mirrorcity-emsdk, about 1 GB on first run).
set -euo pipefail

SWMM_TAG="v5.2.4"         # USEPA/Stormwater-Management-Model release
EMSDK_VERSION="6.0.10"
EMSDK_DIR="${EMSDK_DIR:-$HOME/.cache/mirrorcity-emsdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -d "$EMSDK_DIR" ]; then
  git clone --quiet https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi
"$EMSDK_DIR/emsdk" install "$EMSDK_VERSION" >/dev/null
"$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION" >/dev/null
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

git clone --quiet --depth 1 --branch "$SWMM_TAG" https://github.com/USEPA/Stormwater-Management-Model.git "$WORK/swmm"

mkdir -p "$ROOT/lib/swmm-engine"
# SWMM's OpenMP pragmas only parallelise; Emscripten builds single-threaded.
emcc -O3 -Wno-unknown-pragmas -Wno-everything \
  -I"$WORK/swmm/src/solver" -I"$WORK/swmm/src/solver/include" \
  "$WORK"/swmm/src/solver/*.c \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createSwmm \
  -sENVIRONMENT=web,worker,node -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_swmm_run,_swmm_getVersion \
  -sEXPORTED_RUNTIME_METHODS=FS,ccall \
  -o "$ROOT/lib/swmm-engine/swmm.mjs"

echo "Built lib/swmm-engine/swmm.mjs from EPA SWMM $SWMM_TAG with Emscripten $EMSDK_VERSION"
