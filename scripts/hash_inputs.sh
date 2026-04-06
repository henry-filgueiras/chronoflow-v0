#!/usr/bin/env bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

fail() {
  printf '[hash-inputs] %s\n' "$*" >&2
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

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi

  fail "no sha256 tool found"
}

main() {
  [[ "$#" -ge 2 ]] || fail "usage: hash_inputs.sh OUTPUT INPUTS..."

  local output_file invocation_pwd tmp_file line_hash aggregate
  invocation_pwd="${PWD}"
  output_file="$1"
  shift

  [[ "${output_file}" = /* ]] || output_file="${invocation_pwd}/${output_file}"
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/chronoflow-hash-inputs.XXXXXX")"
  trap "rm -f '${tmp_file}'" EXIT

  local input rel
  for input in "$@"; do
    rel="$(normalize_path "${input}")" || continue
    line_hash="$(hash_file "${input}")"
    printf '%s  %s\n' "${line_hash}" "${rel}" >> "${tmp_file}"
  done

  LC_ALL=C sort -o "${tmp_file}" "${tmp_file}"
  aggregate="$(hash_file "${tmp_file}")"

  {
    printf 'aggregate_sha256 %s\n\n' "${aggregate}"
    cat "${tmp_file}"
  } > "${output_file}"
}

main "$@"
