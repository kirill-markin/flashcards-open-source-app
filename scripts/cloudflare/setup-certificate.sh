#!/usr/bin/env bash
# Create a Cloudflare Origin Certificate and import it into AWS ACM.
# Run once before the first CDK deploy.
#
# Required env vars:
#   CLOUDFLARE_API_TOKEN  — API token with Zone:SSL and Certificates:Edit permissions
#   CLOUDFLARE_ZONE_ID    — Zone ID from Cloudflare dashboard
#   AWS_PROFILE           — AWS CLI profile for the target account
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="..." CLOUDFLARE_ZONE_ID="..." AWS_PROFILE=flashcards-open-source-app
#   bash scripts/cloudflare/setup-certificate.sh --domain flashcards-open-source-app.com --region eu-central-1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-env.sh"

# --- Parse arguments ---
DOMAIN=""
REGION=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$REGION" ]]; then
  echo "Usage: $0 --domain <domain> --region <aws-region>" >&2
  exit 1
fi

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN env var}"
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID env var}"

echo "Creating Cloudflare Origin Certificate for *.${DOMAIN} and ${DOMAIN}..."

# --- Generate RSA private key and CSR ---
TMPDIR_CERT=$(mktemp -d)
KEY_FILE="${TMPDIR_CERT}/origin.key"
CSR_FILE="${TMPDIR_CERT}/origin.csr"

openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$KEY_FILE" \
  -out "$CSR_FILE" \
  -subj "/CN=${DOMAIN}" 2>/dev/null

CSR_PEM=$(cat "$CSR_FILE")

# --- Create Origin Certificate via Cloudflare API ---
CERT_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/certificates" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c '
import json, sys
csr = open(sys.argv[1]).read()
print(json.dumps({
    "hostnames": ["*." + sys.argv[2], sys.argv[2]],
    "requested_validity": 5475,
    "request_type": "origin-rsa",
    "csr": csr
}))
' "$CSR_FILE" "$DOMAIN")")

SUCCESS=$(echo "$CERT_RESPONSE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["success"])')
if [[ "$SUCCESS" != "True" ]]; then
  echo "Failed to create Cloudflare Origin Certificate:" >&2
  echo "$CERT_RESPONSE" | python3 -c 'import sys,json; print(json.dumps(json.load(sys.stdin).get("errors", []), indent=2))' >&2
  rm -rf "$TMPDIR_CERT"
  exit 1
fi

# Extract signed certificate to file
CERT_FILE="${TMPDIR_CERT}/origin.crt"
echo "$CERT_RESPONSE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["certificate"])' > "$CERT_FILE"

echo "Origin Certificate created (15-year validity)."

# --- Import into ACM ---
echo "Importing into AWS ACM (region: ${REGION})..."

CERT_ARN=$(aws acm import-certificate \
  --region "$REGION" \
  --certificate "fileb://${CERT_FILE}" \
  --private-key "fileb://${KEY_FILE}" \
  --query "CertificateArn" --output text)

rm -rf "$TMPDIR_CERT"

echo ""
echo "Certificate imported into ACM."
echo "ARN: ${CERT_ARN}"
echo ""
echo "Add this to cdk.context.local.json:"
echo "  \"certificateArn\": \"${CERT_ARN}\""
