#!/usr/bin/env bash

ROOT_ENV_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_ENV_ROOT_DIR="$(cd "${ROOT_ENV_LIB_DIR}/../.." && pwd)"
ROOT_ENV_FILE="${ROOT_ENV_ROOT_DIR}/.env"

load_root_env() {
  if [[ ! -f "${ROOT_ENV_FILE}" ]]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  source "${ROOT_ENV_FILE}"
  set +a
}
