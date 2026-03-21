#!/usr/bin/env bash

DEPLOY_CONFIG_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${DEPLOY_CONFIG_LIB_DIR}/root-env.sh"

DEPLOY_CONFIG_PROJECT_TAG_KEY="flashcards:project"
DEPLOY_CONFIG_PROJECT_TAG_VALUE="flashcards-open-source-app"
DEPLOY_CONFIG_PURPOSE_TAG_KEY="flashcards:purpose"

normalize_aws_text_value() {
  local value="${1:-}"

  if [[ -z "${value}" || "${value}" == "None" || "${value}" == "null" ]]; then
    return
  fi

  printf '%s\n' "${value}"
}

require_non_empty_value() {
  local value="$1"
  local error_message="$2"

  if [[ -n "${value}" ]]; then
    printf '%s\n' "${value}"
    return
  fi

  echo "ERROR: ${error_message}" >&2
  exit 1
}

find_secret_arn() {
  local region="$1"
  local secret_name="$2"
  local value=""

  value="$(aws --region "${region}" secretsmanager describe-secret \
    --secret-id "${secret_name}" \
    --query ARN \
    --output text 2>/dev/null || true)"

  normalize_aws_text_value "${value}"
}

list_exact_certificate_arns() {
  local region="$1"
  local domain_name="$2"
  local certificates_json=""

  certificates_json="$(aws --region "${region}" acm list-certificates \
    --certificate-statuses ISSUED \
    --output json)"

  python3 - "${certificates_json}" "${domain_name}" <<'PY'
import json
import sys

certificates = json.loads(sys.argv[1]).get("CertificateSummaryList", [])
domain_name = sys.argv[2]

for certificate in certificates:
    if certificate.get("DomainName") == domain_name:
        print(certificate.get("CertificateArn", ""))
PY
}

certificate_has_required_tags() {
  local region="$1"
  local certificate_arn="$2"
  local purpose_tag_value="$3"
  local tags_json=""

  tags_json="$(aws --region "${region}" acm list-tags-for-certificate \
    --certificate-arn "${certificate_arn}" \
    --output json)"

  python3 - "${tags_json}" "${purpose_tag_value}" <<'PY'
import json
import sys

tags = json.loads(sys.argv[1]).get("Tags", [])
purpose = sys.argv[2]
values = {tag.get("Key"): tag.get("Value") for tag in tags}

project_ok = values.get("flashcards:project") == "flashcards-open-source-app"
purpose_ok = values.get("flashcards:purpose") == purpose
print("true" if project_ok and purpose_ok else "")
PY
}

find_certificate_arn() {
  local region="$1"
  local domain_name="$2"
  local purpose_tag_value="$3"
  local certificate_arn=""
  local tagged_matches=()
  local exact_matches=()

  readarray -t exact_matches < <(list_exact_certificate_arns "${region}" "${domain_name}")

  if [[ "${#exact_matches[@]}" -eq 0 ]]; then
    return
  fi

  if [[ "${#exact_matches[@]}" -eq 1 ]]; then
    printf '%s\n' "${exact_matches[0]}"
    return
  fi

  for certificate_arn in "${exact_matches[@]}"; do
    if [[ -n "$(certificate_has_required_tags "${region}" "${certificate_arn}" "${purpose_tag_value}")" ]]; then
      tagged_matches+=("${certificate_arn}")
    fi
  done

  if [[ "${#tagged_matches[@]}" -eq 1 ]]; then
    printf '%s\n' "${tagged_matches[0]}"
    return
  fi

  echo "ERROR: Could not uniquely determine the ACM certificate for ${domain_name} in ${region}." >&2
  echo "Expected one exact issued certificate or one tagged certificate with ${DEPLOY_CONFIG_PURPOSE_TAG_KEY}=${purpose_tag_value}." >&2
  printf 'Candidates:\n' >&2
  printf '  %s\n' "${exact_matches[@]}" >&2
  exit 1
}

build_resend_sender_email() {
  local domain_name="$1"
  printf 'no-reply@mail.%s\n' "${domain_name}"
}

discover_github_oidc_provider_arn() {
  local value=""

  value="$(aws iam list-open-id-connect-providers \
    --output text \
    --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" 2>/dev/null || true)"

  normalize_aws_text_value "${value}"
}
