#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

log() {
  printf '[setup] %s\n' "$*"
}

fail() {
  printf '[setup] %s\n' "$*" >&2
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
      fail "another setup is already running (pid ${existing_pid})"
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

require_cmd() {
  local cmd="$1"
  local help="$2"

  command -v "${cmd}" >/dev/null 2>&1 || fail "${help}"
}

pick_bazel() {
  if command -v bazelisk >/dev/null 2>&1; then
    printf '%s\n' bazelisk
    return
  fi

  if command -v bazel >/dev/null 2>&1; then
    printf '%s\n' bazel
    return
  fi

  fail "bazelisk is required. Run ./bootstrap.sh first."
}

setup_cache_inputs() {
  local root="$1"

  (
    cd "${root}"

    printf '%s\n' \
      ".bazelignore" \
      ".bazelrc" \
      ".bazelversion" \
      "BUILD.bazel" \
      "Dockerfile.dev" \
      "MODULE.bazel" \
      "MODULE.bazel.lock" \
      "bootstrap.sh" \
      "docker-compose.yml" \
      "package-lock.json" \
      "package.json" \
      "setup.sh"

    find scripts -type f -print 2>/dev/null | LC_ALL=C sort
  )
}

bazel_bin_dir() {
  local bazel_cmd="$1"
  "${bazel_cmd}" info bazel-bin
}

setup_done_path() {
  local bazel_bin="$1"
  printf '%s\n' "${bazel_bin}/chronoflow/setup.done"
}

compute_setup_fingerprint() {
  local root="$1"
  local tmp_output
  tmp_output="$(mktemp "${TMPDIR:-/tmp}/chronoflow-setup-fingerprint.XXXXXX")"

  local inputs=()
  local relative_path
  while IFS= read -r relative_path; do
    [[ -n "${relative_path}" ]] || continue
    inputs+=("${root}/${relative_path}")
  done < <(setup_cache_inputs "${root}")

  "${root}/scripts/hash_inputs.sh" "${tmp_output}" "${inputs[@]}"
  local fingerprint
  fingerprint="$(awk 'NR == 1 { print $2 }' "${tmp_output}")"
  rm -f "${tmp_output}"
  printf '%s\n' "${fingerprint}"
}

cached_setup_is_current() {
  local done_file="$1"
  local expected_fingerprint="$2"
  local root="$3"

  [[ -d "${root}/node_modules" ]] || return 1
  [[ -f "${done_file}" ]] || return 1

  local cached_fingerprint
  cached_fingerprint="$(awk '/^setup_fingerprint / { print $2; exit }' "${done_file}")"
  [[ "${cached_fingerprint}" == "${expected_fingerprint}" ]]
}

write_done_file() {
  local done_file="$1"
  local fingerprint="$2"

  mkdir -p "$(dirname "${done_file}")"
  cat >"${done_file}" <<EOF
setup_fingerprint ${fingerprint}
completed_at $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
}

main() {
  local force=0
  if [[ "${1:-}" == "--force" ]]; then
    force=1
  fi

  local root
  root="$(workspace_root)"
  local lock_dir="${root}/.chronoflow/locks/setup.lock"

  cd "${root}"

  acquire_lock "${lock_dir}"
  trap "release_lock '${lock_dir}'" EXIT

  require_cmd node "node is required. Run ./bootstrap.sh first."
  require_cmd npm "npm is required. Run ./bootstrap.sh first."
  require_cmd docker "docker is required. Run ./bootstrap.sh first."
  docker compose version >/dev/null 2>&1 || fail "docker compose is required. Start Docker Desktop and rerun ./setup.sh."

  local bazel_cmd
  bazel_cmd="$(pick_bazel)"
  local bazel_bin
  bazel_bin="$(bazel_bin_dir "${bazel_cmd}")"
  local done_file
  done_file="$(setup_done_path "${bazel_bin}")"
  local setup_fingerprint
  setup_fingerprint="$(compute_setup_fingerprint "${root}")"

  if [[ "${force}" -eq 0 ]] && cached_setup_is_current "${done_file}" "${setup_fingerprint}" "${root}"; then
    log "setup already current"
    log "cached marker: ${done_file}"
    return
  fi

  log "installing JavaScript dependencies with npm ci"
  npm ci --no-fund --no-audit

  log "warming Bazel memoized targets"
  "${bazel_cmd}" build //:local_stack_fingerprint //:app_dist_tar

  write_done_file "${done_file}" "${setup_fingerprint}"

  log "setup complete"
  log "cached marker: ${done_file}"
  log "run locally with: ${bazel_cmd} run //:dev"
  log "run in Docker with: ${bazel_cmd} run //:docker_compose_up"
}

main "$@"
