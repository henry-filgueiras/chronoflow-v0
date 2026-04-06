#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
export COPYFILE_DISABLE=1

fail() {
  printf '[build-dist] %s\n' "$*" >&2
  exit 1
}

normalize_path() {
  local input="$1"

  if [[ "${input}" != /* ]]; then
    printf '%s\n' "${input#./}"
    return 0
  fi

  case "${input}" in
    */execroot/*/*)
      input="${input#*/execroot/}"
      printf '%s\n' "${input#*/}"
      return 0
      ;;
  esac

  return 1
}

main() {
  [[ "$#" -ge 2 ]] || fail "usage: build_dist.sh OUTPUT_TAR INPUTS..."

  local invocation_pwd output_tar tmp_root temp_repo home_dir npm_cache
  invocation_pwd="${PWD}"
  output_tar="$1"
  shift

  [[ "${output_tar}" = /* ]] || output_tar="${invocation_pwd}/${output_tar}"

  command -v npm >/dev/null 2>&1 || fail "npm must be available on PATH"

  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/chronoflow-bazel-build.XXXXXX")"
  temp_repo="${tmp_root}/repo"
  home_dir="${tmp_root}/home"
  npm_cache="${tmp_root}/npm-cache"

  trap "rm -rf '${tmp_root}'" EXIT

  mkdir -p "${temp_repo}" "${home_dir}" "${npm_cache}"

  local input rel
  for input in "$@"; do
    rel="$(normalize_path "${input}")" || continue
    mkdir -p "${temp_repo}/$(dirname "${rel}")"
    cp "${input}" "${temp_repo}/${rel}"
  done

  cd "${temp_repo}"

  export HOME="${home_dir}"
  export npm_config_cache="${npm_cache}"
  export npm_config_update_notifier=false
  export npm_config_fund=false
  export npm_config_audit=false

  npm ci --no-fund --no-audit
  npm run build

  mkdir -p "$(dirname "${output_tar}")"
  tar -cf "${output_tar}" -C dist .
}

main "$@"
