#!/usr/bin/env bash
# Create an ACM public certificate for the apex redirect domain and validate it via Cloudflare DNS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-env.sh"

DOMAIN=""
REGION="us-east-1"

while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 --domain <domain>" >&2
  exit 1
fi

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN env var}"
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID env var}"

echo "Requesting ACM certificate for ${DOMAIN} in ${REGION}..."

CERT_ARN=$(aws acm request-certificate \
  --region "$REGION" \
  --domain-name "$DOMAIN" \
  --validation-method DNS \
  --tags \
    Key=flashcards:project,Value=flashcards-open-source-app \
    Key=flashcards:purpose,Value=apex-redirect-domain \
  --query "CertificateArn" \
  --output text)

echo "Certificate ARN: ${CERT_ARN}"
echo "Waiting for ACM to generate validation DNS record..."

VALIDATION_JSON=""
for i in $(seq 1 24); do
  VALIDATION_JSON=$(aws acm describe-certificate \
    --region "$REGION" \
    --certificate-arn "$CERT_ARN" \
    --query "Certificate.DomainValidationOptions[0].ResourceRecord" \
    --output json)
  if [[ "$VALIDATION_JSON" != "null" ]]; then
    break
  fi
  sleep 5
done

if [[ "$VALIDATION_JSON" == "null" || -z "$VALIDATION_JSON" ]]; then
  echo "Timed out waiting for ACM validation record." >&2
  echo "Certificate ARN: ${CERT_ARN}" >&2
  exit 1
fi

VALIDATION_NAME=$(echo "$VALIDATION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['Name'].rstrip('.'))")
VALIDATION_VALUE=$(echo "$VALIDATION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['Value'].rstrip('.'))")

EXISTING=$(curl -s "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${VALIDATION_NAME}&type=CNAME" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

EXISTING_COUNT=$(echo "$EXISTING" | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("result", [])))')

if [[ "$EXISTING_COUNT" -gt 0 ]]; then
  RECORD_ID=$(echo "$EXISTING" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"][0]["id"])')
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"${VALIDATION_NAME}\",
      \"content\": \"${VALIDATION_VALUE}\",
      \"ttl\": 120,
      \"proxied\": false
    }" | python3 -c 'import sys,json; r=json.load(sys.stdin); print("OK" if r["success"] else json.dumps(r["errors"], indent=2))'
else
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"${VALIDATION_NAME}\",
      \"content\": \"${VALIDATION_VALUE}\",
      \"ttl\": 120,
      \"proxied\": false
    }" | python3 -c 'import sys,json; r=json.load(sys.stdin); print("OK" if r["success"] else json.dumps(r["errors"], indent=2))'
fi

echo "Waiting for ACM certificate validation..."
aws acm wait certificate-validated \
  --region "$REGION" \
  --certificate-arn "$CERT_ARN"

echo ""
echo "Certificate ISSUED."
echo "ARN: ${CERT_ARN}"
echo "This certificate can now be rediscovered by setup-github.sh and generate-cdk-context.sh."
