#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

fail() {
  printf '[docker-dev] %s\n' "$*" >&2
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

  command -v docker >/dev/null 2>&1 || fail "docker is required."

  cd "${root}"
  exec docker compose logs -f chronoflow-dev
}

main "$@"
