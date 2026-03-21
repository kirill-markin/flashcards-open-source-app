#!/usr/bin/env bash
# Validate that every configured review/demo email has a matching Cognito user.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
REGION="${AWS_REGION:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

AWS_REGION_ARGS=()
if [[ -n "$REGION" ]]; then
  AWS_REGION_ARGS=(--region "$REGION")
fi

get_stack_output() {
  local output_key="$1"

  aws "${AWS_REGION_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

AUTH_FUNCTION_NAME="$(get_stack_output "AuthFunctionName")"

if [[ -z "$AUTH_FUNCTION_NAME" || "$AUTH_FUNCTION_NAME" == "None" ]]; then
  echo "ERROR: AuthFunctionName output not found. Deploy the stack first." >&2
  exit 1
fi

LAMBDA_CONFIG_JSON="$(aws "${AWS_REGION_ARGS[@]}" lambda get-function-configuration \
  --function-name "$AUTH_FUNCTION_NAME" \
  --query '{demoEmails: Environment.Variables.DEMO_EMAIL_DOSTIP, demoPassword: Environment.Variables.DEMO_PASSWORD_DOSTIP, demoPasswordSecretArn: Environment.Variables.DEMO_PASSWORD_SECRET_ARN, userPoolId: Environment.Variables.COGNITO_USER_POOL_ID, cognitoRegion: Environment.Variables.COGNITO_REGION}' \
  --output json)"

readarray -t CONFIG_LINES < <(python3 - <<'PY' "$LAMBDA_CONFIG_JSON"
import json
import sys

config = json.loads(sys.argv[1])
demo_emails = config.get("demoEmails") or ""
emails = [value.strip().lower() for value in demo_emails.split(",") if value.strip()]

print(config.get("demoPassword") or "")
print(config.get("demoPasswordSecretArn") or "")
print(config.get("userPoolId") or "")
print(config.get("cognitoRegion") or "")
for email in emails:
    print(email)
PY
)

DEMO_PASSWORD="${CONFIG_LINES[0]:-}"
DEMO_PASSWORD_SECRET_ARN="${CONFIG_LINES[1]:-}"
USER_POOL_ID="${CONFIG_LINES[2]:-}"
COGNITO_REGION="${CONFIG_LINES[3]:-}"
DEMO_EMAILS=("${CONFIG_LINES[@]:4}")

if [[ "${#DEMO_EMAILS[@]}" -eq 0 ]]; then
  echo "No review/demo Cognito users are configured in auth Lambda."
  exit 0
fi

if [[ -n "$DEMO_PASSWORD" && -n "$DEMO_PASSWORD_SECRET_ARN" ]]; then
  echo "ERROR: Configure only one of DEMO_PASSWORD_DOSTIP or DEMO_PASSWORD_SECRET_ARN on ${AUTH_FUNCTION_NAME}." >&2
  exit 1
fi

if [[ -z "$USER_POOL_ID" ]]; then
  echo "ERROR: COGNITO_USER_POOL_ID is empty on ${AUTH_FUNCTION_NAME}." >&2
  exit 1
fi

if [[ -z "$COGNITO_REGION" ]]; then
  COGNITO_REGION="$REGION"
fi

if [[ -z "$COGNITO_REGION" ]]; then
  echo "ERROR: Could not determine Cognito region. Pass --region or set AWS_REGION." >&2
  exit 1
fi

if [[ -z "$DEMO_PASSWORD" && -z "$DEMO_PASSWORD_SECRET_ARN" ]]; then
  echo "ERROR: DEMO_PASSWORD_DOSTIP and DEMO_PASSWORD_SECRET_ARN are empty while DEMO_EMAIL_DOSTIP is configured on ${AUTH_FUNCTION_NAME}." >&2
  exit 1
fi

if [[ -n "$DEMO_PASSWORD_SECRET_ARN" ]]; then
  DEMO_PASSWORD="$(aws --region "$COGNITO_REGION" secretsmanager get-secret-value \
    --secret-id "$DEMO_PASSWORD_SECRET_ARN" \
    --query 'SecretString' \
    --output text)"
fi

PASSWORD_POLICY_JSON="$(aws --region "$COGNITO_REGION" cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --query 'UserPool.Policies.PasswordPolicy' \
  --output json)"

readarray -t PASSWORD_POLICY_ERRORS < <(python3 - <<'PY' "$DEMO_PASSWORD" "$PASSWORD_POLICY_JSON"
import json
import re
import sys

password = sys.argv[1]
policy = json.loads(sys.argv[2])
errors = []

minimum_length = int(policy.get("MinimumLength", 0))
if len(password) < minimum_length:
    errors.append(f"DEMO_PASSWORD_DOSTIP is shorter than the Cognito minimum length ({minimum_length}).")

checks = [
    (bool(policy.get("RequireUppercase")), re.search(r"[A-Z]", password) is not None, "DEMO_PASSWORD_DOSTIP must include an uppercase letter."),
    (bool(policy.get("RequireLowercase")), re.search(r"[a-z]", password) is not None, "DEMO_PASSWORD_DOSTIP must include a lowercase letter."),
    (bool(policy.get("RequireNumbers")), re.search(r"[0-9]", password) is not None, "DEMO_PASSWORD_DOSTIP must include a number."),
    (bool(policy.get("RequireSymbols")), re.search(r"[^A-Za-z0-9]", password) is not None, "DEMO_PASSWORD_DOSTIP must include a symbol."),
]

for required, passed, message in checks:
    if required and not passed:
        errors.append(message)

for error in errors:
    print(error)
PY
)

echo "Checking review/demo Cognito users for ${AUTH_FUNCTION_NAME} in ${COGNITO_REGION}..."
echo "User pool: ${USER_POOL_ID}"

MISSING_EMAILS=()

for email in "${DEMO_EMAILS[@]}"; do
  output=$(aws --region "$COGNITO_REGION" cognito-idp list-users \
    --user-pool-id "$USER_POOL_ID" \
    --filter "email = \"${email}\"" \
    --query 'length(Users)' \
    --output text 2>&1) || {
      echo "ERROR: Failed to check ${email}: ${output}" >&2
      exit 1
    }

  if [[ "$output" == "1" ]]; then
    echo "OK: ${email}"
    continue
  fi

  echo "MISSING: ${email}"
  MISSING_EMAILS+=("$email")
done

HAS_ERRORS="false"

if [[ "${#PASSWORD_POLICY_ERRORS[@]}" -gt 0 ]]; then
  HAS_ERRORS="true"
  echo "ERROR: DEMO_PASSWORD_DOSTIP does not satisfy the Cognito password policy." >&2
  for error in "${PASSWORD_POLICY_ERRORS[@]}"; do
    echo "$error" >&2
  done
fi

if [[ "${#MISSING_EMAILS[@]}" -gt 0 ]]; then
  HAS_ERRORS="true"
  echo "ERROR: Missing review/demo Cognito users detected." >&2
  for email in "${MISSING_EMAILS[@]}"; do
    echo "Create Cognito user for: ${email}" >&2
  done
fi

if [[ "$HAS_ERRORS" == "true" ]]; then
  exit 1
fi

echo "All configured review/demo emails have matching Cognito users."
