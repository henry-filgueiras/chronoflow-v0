#!/usr/bin/env bash
set -euo pipefail

cd /workspace

current_hash="$(
  cat package.json package-lock.json | sha256sum | awk '{print $1}'
)"
cached_hash="$(cat node_modules/.chronoflow-deps.sha256 2>/dev/null || true)"

if [[ ! -d node_modules ]] || [[ "${current_hash}" != "${cached_hash}" ]]; then
  printf '[container-dev] syncing dependencies with npm ci\n'
  npm ci --no-fund --no-audit
  printf '%s\n' "${current_hash}" > node_modules/.chronoflow-deps.sha256
fi

exec npm run dev -- --host 0.0.0.0 --port 4173
