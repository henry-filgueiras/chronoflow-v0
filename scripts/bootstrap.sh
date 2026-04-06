#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

log() {
  printf '[bootstrap] %s\n' "$*"
}

fail() {
  printf '[bootstrap] %s\n' "$*" >&2
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

acquire_lock() {
  local lock_dir="$1"
  local pid_file="${lock_dir}/pid"

  mkdir -p "$(dirname "${lock_dir}")"

  if mkdir "${lock_dir}" 2>/dev/null; then
    printf '%s\n' "$$" >"${pid_file}"
    return
  fi

  if [[ -f "${pid_file}" ]]; then
    local existing_pid
    existing_pid="$(cat "${pid_file}")"
    if kill -0 "${existing_pid}" 2>/dev/null; then
      fail "another bootstrap is already running (pid ${existing_pid})"
    fi
    rm -rf "${lock_dir}"
    mkdir "${lock_dir}"
    printf '%s\n' "$$" >"${pid_file}"
    return
  fi

  fail "could not acquire lock at ${lock_dir}"
}

release_lock() {
  local lock_dir="$1"
  rm -rf "${lock_dir}"
}

ensure_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "bootstrap currently assumes macOS + Homebrew."
}

ensure_homebrew() {
  command -v brew >/dev/null 2>&1 || fail "Homebrew is required. Install Homebrew first, then rerun ./bootstrap.sh."
}

ensure_formula() {
  local formula="$1"

  if brew list "${formula}" >/dev/null 2>&1; then
    log "${formula} already installed"
    return
  fi

  log "installing ${formula} via Homebrew"
  brew install "${formula}"
}

ensure_docker_desktop() {
  if brew list --cask docker-desktop >/dev/null 2>&1 || [[ -d /Applications/Docker.app ]]; then
    log "docker-desktop already installed"
    return
  fi

  log "installing docker-desktop via Homebrew"
  brew install --cask docker-desktop
}

main() {
  local root
  root="$(workspace_root)"
  local lock_dir="${root}/.chronoflow/locks/bootstrap.lock"

  acquire_lock "${lock_dir}"
  trap "release_lock '${lock_dir}'" EXIT

  ensure_macos
  ensure_homebrew

  ensure_formula node
  ensure_formula bazelisk
  ensure_docker_desktop

  if ! command -v docker >/dev/null 2>&1; then
    log "Docker CLI is not on PATH yet. Start Docker Desktop once, then open a new shell."
  fi

  log "bootstrap complete"
  log "next: ./setup.sh"
}

main "$@"
