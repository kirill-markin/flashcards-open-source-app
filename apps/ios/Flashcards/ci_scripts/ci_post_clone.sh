#!/bin/sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT_DIR="$(cd "${PROJECT_DIR}/../../.." && pwd)"
LOCAL_XCCONFIG_PATH="${PROJECT_DIR}/Config/Local.xcconfig"
LOCAL_ENV_PATH="${REPO_ROOT_DIR}/.env"
LOCAL_SENTRY_ENV_PATH="${REPO_ROOT_DIR}/.env.sentry"
REQUIRED_URL_PREFIX='https:/$()/'

append_missing_key() {
  key="$1"

  if [ -n "${MISSING_KEYS}" ]; then
    MISSING_KEYS="${MISSING_KEYS}, ${key}"
    return
  fi

  MISSING_KEYS="${key}"
}

validate_required_value() {
  key="$1"
  value="$2"

  if [ -n "${value}" ]; then
    return
  fi

  append_missing_key "${key}"
}

validate_required_url_value() {
  key="$1"
  value="$2"

  case "${value}" in
    "${REQUIRED_URL_PREFIX}"*)
      return
      ;;
    *)
      echo "Xcode Cloud environment variable ${key} must start with ${REQUIRED_URL_PREFIX}. Received: ${value}" >&2
      exit 1
      ;;
  esac
}

validate_sample_rate_value() {
  key="$1"
  value="$2"

  if printf "%s\n" "${value}" | awk '
    /^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$/ {
      sampleRate = $1 + 0
      if (sampleRate >= 0 && sampleRate <= 1) {
        exit 0
      }
    }
    {
      exit 1
    }
  '; then
    return
  fi

  echo "Xcode Cloud environment variable ${key} must be numeric between 0.0 and 1.0. Received: ${value}" >&2
  exit 1
}

escape_xcconfig_url_value() {
  value="$1"

  printf "%s" "${value}" | sed 's#://#:/$()/#g'
}

load_local_env_file() {
  env_path="$1"

  if [ ! -f "${env_path}" ]; then
    return
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      "" | \#*)
        continue
        ;;
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        ;;
      *)
        continue
        ;;
    esac

    case "${key}" in
      XCODE_CLOUD_DEVELOPMENT_TEAM | XCODE_CLOUD_APP_BUNDLE_IDENTIFIER | XCODE_CLOUD_API_BASE_URL | XCODE_CLOUD_AUTH_BASE_URL | XCODE_CLOUD_PRIVACY_POLICY_URL | XCODE_CLOUD_TERMS_OF_SERVICE_URL | XCODE_CLOUD_SUPPORT_URL | XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS | XCODE_CLOUD_SENTRY_DSN | XCODE_CLOUD_SENTRY_ENVIRONMENT | XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE | FLASHCARDS_LIVE_REVIEW_EMAIL)
        eval "current_value=\${${key}:-}"

        if [ -n "${current_value}" ]; then
          continue
        fi

        escaped_value=$(printf "%s" "${value}" | sed "s/'/'\\\\''/g")
        eval "${key}='${escaped_value}'"
        export "${key}"
        ;;
    esac
  done < "${env_path}"
}

load_local_env_defaults() {
  load_local_env_file "${LOCAL_SENTRY_ENV_PATH}"
  load_local_env_file "${LOCAL_ENV_PATH}"
}

if [ "${CI_XCODE_CLOUD:-}" != "TRUE" ]; then
  load_local_env_defaults
fi

XCODE_CLOUD_DEVELOPMENT_TEAM_VALUE="${XCODE_CLOUD_DEVELOPMENT_TEAM:-}"
XCODE_CLOUD_APP_BUNDLE_IDENTIFIER_VALUE="${XCODE_CLOUD_APP_BUNDLE_IDENTIFIER:-}"
XCODE_CLOUD_API_BASE_URL_VALUE="${XCODE_CLOUD_API_BASE_URL:-}"
XCODE_CLOUD_AUTH_BASE_URL_VALUE="${XCODE_CLOUD_AUTH_BASE_URL:-}"
XCODE_CLOUD_PRIVACY_POLICY_URL_VALUE="${XCODE_CLOUD_PRIVACY_POLICY_URL:-}"
XCODE_CLOUD_TERMS_OF_SERVICE_URL_VALUE="${XCODE_CLOUD_TERMS_OF_SERVICE_URL:-}"
XCODE_CLOUD_SUPPORT_URL_VALUE="${XCODE_CLOUD_SUPPORT_URL:-}"
XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS_VALUE="${XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS:-}"
XCODE_CLOUD_SENTRY_DSN_VALUE="${XCODE_CLOUD_SENTRY_DSN:-}"
if [ "${CI_XCODE_CLOUD:-}" = "TRUE" ]; then
  XCODE_CLOUD_SENTRY_ENVIRONMENT_VALUE="${XCODE_CLOUD_SENTRY_ENVIRONMENT:-production}"
  XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE_VALUE="${XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE:-0.0}"
else
  XCODE_CLOUD_SENTRY_ENVIRONMENT_VALUE="${XCODE_CLOUD_SENTRY_ENVIRONMENT:-local}"
  XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE_VALUE="${XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE:-0.0}"
fi
MISSING_KEYS=""

if [ "${CI_XCODE_CLOUD:-}" != "TRUE" ] &&
  [ -z "${XCODE_CLOUD_DEVELOPMENT_TEAM_VALUE}${XCODE_CLOUD_APP_BUNDLE_IDENTIFIER_VALUE}${XCODE_CLOUD_API_BASE_URL_VALUE}${XCODE_CLOUD_AUTH_BASE_URL_VALUE}${XCODE_CLOUD_PRIVACY_POLICY_URL_VALUE}${XCODE_CLOUD_TERMS_OF_SERVICE_URL_VALUE}${XCODE_CLOUD_SUPPORT_URL_VALUE}${XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS_VALUE}" ]; then
  exit 0
fi

# Xcode Cloud is the canonical signed archive path. Local generation reuses the
# same XCODE_CLOUD_* inputs from the root .env to keep signed archives aligned.
validate_required_value "XCODE_CLOUD_DEVELOPMENT_TEAM" "${XCODE_CLOUD_DEVELOPMENT_TEAM_VALUE}"
validate_required_value "XCODE_CLOUD_APP_BUNDLE_IDENTIFIER" "${XCODE_CLOUD_APP_BUNDLE_IDENTIFIER_VALUE}"
validate_required_value "XCODE_CLOUD_API_BASE_URL" "${XCODE_CLOUD_API_BASE_URL_VALUE}"
validate_required_value "XCODE_CLOUD_AUTH_BASE_URL" "${XCODE_CLOUD_AUTH_BASE_URL_VALUE}"
validate_required_value "XCODE_CLOUD_PRIVACY_POLICY_URL" "${XCODE_CLOUD_PRIVACY_POLICY_URL_VALUE}"
validate_required_value "XCODE_CLOUD_TERMS_OF_SERVICE_URL" "${XCODE_CLOUD_TERMS_OF_SERVICE_URL_VALUE}"
validate_required_value "XCODE_CLOUD_SUPPORT_URL" "${XCODE_CLOUD_SUPPORT_URL_VALUE}"
validate_required_value "XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS" "${XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS_VALUE}"
if [ "${CI_XCODE_CLOUD:-}" = "TRUE" ]; then
  validate_required_value "XCODE_CLOUD_SENTRY_DSN" "${XCODE_CLOUD_SENTRY_DSN_VALUE}"
fi

if [ -n "${MISSING_KEYS}" ]; then
  echo "Xcode Cloud requires these workflow environment variables before build: ${MISSING_KEYS}" >&2
  exit 1
fi

validate_required_url_value "XCODE_CLOUD_API_BASE_URL" "${XCODE_CLOUD_API_BASE_URL_VALUE}"
validate_required_url_value "XCODE_CLOUD_AUTH_BASE_URL" "${XCODE_CLOUD_AUTH_BASE_URL_VALUE}"
validate_required_url_value "XCODE_CLOUD_PRIVACY_POLICY_URL" "${XCODE_CLOUD_PRIVACY_POLICY_URL_VALUE}"
validate_required_url_value "XCODE_CLOUD_TERMS_OF_SERVICE_URL" "${XCODE_CLOUD_TERMS_OF_SERVICE_URL_VALUE}"
validate_required_url_value "XCODE_CLOUD_SUPPORT_URL" "${XCODE_CLOUD_SUPPORT_URL_VALUE}"
validate_sample_rate_value "XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE" "${XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE_VALUE}"

XCODE_CLOUD_SENTRY_DSN_XCCONFIG_VALUE="$(escape_xcconfig_url_value "${XCODE_CLOUD_SENTRY_DSN_VALUE}")"

cat > "${LOCAL_XCCONFIG_PATH}" <<EOF
// Generated by ci_scripts/ci_post_clone.sh.
// Do not commit this file. Regenerate it from XCODE_CLOUD_* environment variables.
EOF

printf 'DEVELOPMENT_TEAM = %s\n' "${XCODE_CLOUD_DEVELOPMENT_TEAM_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'APP_BUNDLE_IDENTIFIER = %s\n' "${XCODE_CLOUD_APP_BUNDLE_IDENTIFIER_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'API_BASE_URL = %s\n' "${XCODE_CLOUD_API_BASE_URL_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'AUTH_BASE_URL = %s\n' "${XCODE_CLOUD_AUTH_BASE_URL_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'PRIVACY_POLICY_URL = %s\n' "${XCODE_CLOUD_PRIVACY_POLICY_URL_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'TERMS_OF_SERVICE_URL = %s\n' "${XCODE_CLOUD_TERMS_OF_SERVICE_URL_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'SUPPORT_URL = %s\n' "${XCODE_CLOUD_SUPPORT_URL_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'SUPPORT_EMAIL_ADDRESS = %s\n' "${XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'FLASHCARDS_SENTRY_DSN = %s\n' "${XCODE_CLOUD_SENTRY_DSN_XCCONFIG_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'FLASHCARDS_SENTRY_ENVIRONMENT = %s\n' "${XCODE_CLOUD_SENTRY_ENVIRONMENT_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"
printf 'FLASHCARDS_SENTRY_TRACES_SAMPLE_RATE = %s\n' "${XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE_VALUE}" >> "${LOCAL_XCCONFIG_PATH}"

echo "Generated ${LOCAL_XCCONFIG_PATH} from XCODE_CLOUD_* inputs."
