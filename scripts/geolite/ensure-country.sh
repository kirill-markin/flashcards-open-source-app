#!/usr/bin/env bash
set -euo pipefail
set +x

: "${STACK_NAME:?STACK_NAME is required}"

bucket="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='GeoLiteCountryBucketName'].OutputValue | [0]" --output text)"
if [[ -z "$bucket" || "$bucket" == "None" ]]; then
  echo "GeoLite Country bucket is missing. Deploy the infrastructure through AWS/Web Release first." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 700 "$work_dir"

if apps/backend/node_modules/.bin/tsx apps/backend/scripts/check-published-geolite-country.ts \
  "$bucket" "$work_dir/GeoLite2-Country.mmdb"; then
  exit 0
else
  status=$?
fi

case "$status" in
  2|3)
    bash scripts/geolite/refresh-country.sh
    apps/backend/node_modules/.bin/tsx apps/backend/scripts/check-published-geolite-country.ts \
      "$bucket" "$work_dir/GeoLite2-Country.mmdb"
    ;;
  *)
    echo "Published GeoLite Country validation failed; release stopped. Inspect the error above. AccessDenied is not treated as missing: verify the deploy role, and use GeoLite Country Refresh on main to restore an absent object." >&2
    exit "$status"
    ;;
esac
