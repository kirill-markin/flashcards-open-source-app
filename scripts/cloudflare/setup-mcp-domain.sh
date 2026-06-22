#!/usr/bin/env bash
# Create an ACM public certificate for the MCP API Gateway custom domain and validate via Cloudflare DNS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "${SCRIPT_DIR}/setup-api-domain.sh" \
  --api-subdomain mcp \
  --certificate-purpose mcp-domain \
  "$@"
