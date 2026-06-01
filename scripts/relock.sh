#!/usr/bin/env bash
# Regenerate package-lock.json on Linux/Node 22 (the CI platform).
#
# Why this exists: vitest's bundler (rolldown) lists every platform
# binding as an optionalDependency, and the wasm32 binding
# (@rolldown/binding-wasm32-wasi) hard-depends on @emnapi/core and
# @emnapi/runtime — the WASI fallback. When `npm install` runs on macOS
# (or any platform that uses a NATIVE binding), npm installs the native
# binding and omits the @emnapi packages from the lockfile. `npm ci` on
# Linux then validates the full optional-dep graph and fails with
# "Missing: @emnapi/core from lock file".
#
# The fix npm itself documents: regenerate the lockfile on the same
# platform CI uses. This script does that in a throwaway Linux container
# so the result is identical regardless of who runs it.
#
# Usage:
#   npm run relock          # rewrite package-lock.json in place
#   npm run relock:check    # fail if a relock would change the lockfile
#
# Requires Docker. After running, DO NOT `npm install` on macOS before
# committing — a bare install will strip the @emnapi entries back out.
set -euo pipefail

CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

if ! command -v docker >/dev/null 2>&1; then
  echo "relock: Docker is required but not found on PATH." >&2
  echo "        Install Docker, or regenerate package-lock.json on a Linux/Node 22 host." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "relock: Docker is installed but the daemon is not running. Start Docker and retry." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_IMAGE="node:22-bookworm"

if [[ "$CHECK" == "1" ]]; then
  BEFORE="$(shasum package-lock.json | awk '{print $1}')"
fi

echo "relock: regenerating package-lock.json in ${NODE_IMAGE} (matches CI)…"
# --package-lock-only: rewrite the lockfile without building node_modules.
# --ignore-scripts: don't run install hooks (the prepare build) — we only
# want the dependency graph resolved.
docker run --rm -v "${REPO_ROOT}":/app -w /app "${NODE_IMAGE}" \
  npm install --package-lock-only --ignore-scripts >/dev/null

if [[ "$CHECK" == "1" ]]; then
  AFTER="$(shasum package-lock.json | awk '{print $1}')"
  if [[ "$BEFORE" != "$AFTER" ]]; then
    echo "relock: package-lock.json was out of sync — it has been updated. Commit the change." >&2
    exit 1
  fi
  echo "relock: package-lock.json is already in sync. ✓"
else
  echo "relock: done. Review the diff and commit package-lock.json."
  echo "        (Do not run a bare 'npm install' on macOS before committing.)"
fi
