#!/usr/bin/env bash
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
if [[ -z "$REGION" ]]; then
  echo "AWS region is required" >&2
  exit 1
fi

gate_dir="$(mktemp -d)"
trap 'rm -rf "$gate_dir"' EXIT
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --output json > "$gate_dir/stack.json"
readarray -t gate_config < <(python3 - "$gate_dir/stack.json" <<'PY'
import json
import sys
outputs = {row['OutputKey']: row['OutputValue'] for row in json.load(open(sys.argv[1]))['Stacks'][0]['Outputs']}
for key in ('NativeProofGateFunctionName', 'CognitoUserPoolId'):
    print(outputs[key])
PY
)
if [[ "${#gate_config[@]}" -ne 2 || -z "${gate_config[0]}" || -z "${gate_config[1]}" ]]; then
  echo "Native proof gate stack outputs are required" >&2
  exit 1
fi

aws cognito-idp describe-user-pool --user-pool-id "${gate_config[1]}" --region "$REGION" \
  --query 'UserPool.{factors:Policies.SignInPolicy.AllowedFirstAuthFactors,signup:AdminCreateUserConfig.AllowAdminCreateUserOnly}' \
  --output json > "$gate_dir/pool.json"
python3 - "$gate_dir/pool.json" <<'PY'
import json
import sys
pool = json.load(open(sys.argv[1]))
if not {'PASSWORD', 'EMAIL_OTP'}.issubset(set(pool['factors'])) or pool['signup'] is not True:
    raise SystemExit('Existing PASSWORD/EMAIL_OTP factors and disabled public signup must remain configured')
print('EMAIL_OTP policy capability preserved; no mailbox delivery or OTP completion tested')
PY

aws lambda invoke --function-name "${gate_config[0]}" --region "$REGION" \
  --cli-read-timeout 120 --payload '{}' --cli-binary-format raw-in-base64-out \
  "$gate_dir/result.json" > "$gate_dir/invocation.json"
python3 - "$gate_dir/invocation.json" "$gate_dir/result.json" <<'PY'
import json
import sys
invocation = json.load(open(sys.argv[1]))
if invocation.get('FunctionError') or invocation.get('StatusCode') != 200:
    raise SystemExit('Private native proof bridge gate failed; inspect its CloudWatch logs')
result = json.load(open(sys.argv[2]))
expected = {'USER_AUTH/PASSWORD', 'CUSTOM_AUTH', 'forged-metadata', 'wrong-client', 'wrong-nonce',
            'expired-grant', 'SQL-wrong-principal/username', 'atomic-redemption', 'session-and-grant-replay',
            'GetTokensFromRefreshToken', 'internal-bridge', 'signed-original-auth-time', 'account-method-demo-transport-refusals'}
if result.get('passed') is not True or set(result.get('checks', [])) != expected:
    raise SystemExit('Private native proof bridge gate did not return all required passing facts')
print('Native proof bridge cloud gate passed: ' + ', '.join(sorted(expected)))
print('This gate does not validate non-demo account management, browser CSRF bootstrap, Apple/Google proofs, or mailbox delivery')
PY

node "$(dirname "$0")/check-social-sign-in.mjs"
