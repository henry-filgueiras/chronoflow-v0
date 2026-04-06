#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

fail() {
  printf '[dev] %s\n' "$*" >&2
  exit 1
}

workspace_root() {
  if [[ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]]; then
    printf '%s\n' "${BUILD_WORKSPACE_DIRECTORY}"
    return
  fi

  cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1
  pwd
}

main() {
  local root
  root="$(workspace_root)"

  command -v npm >/dev/null 2>&1 || fail "npm is required. Run ./bootstrap.sh first."

  cd "${root}"

  if [[ ! -d node_modules ]]; then
    printf '[dev] node_modules is missing; running npm ci first\n'
    npm ci --no-fund --no-audit
  fi

  exec npm run dev -- --host 0.0.0.0 --port 4173
}

main "$@"
