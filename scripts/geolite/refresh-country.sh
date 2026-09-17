#!/usr/bin/env bash
set -euo pipefail
set +x

: "${MAXMIND_ACCOUNT_ID:?GitHub secret MAXMIND_ACCOUNT_ID is required}"
: "${MAXMIND_LICENSE_KEY:?GitHub secret MAXMIND_LICENSE_KEY is required}"
: "${STACK_NAME:?STACK_NAME is required}"

bucket="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='GeoLiteCountryBucketName'].OutputValue | [0]" --output text)"
if [[ -z "$bucket" || "$bucket" == "None" ]]; then
  echo "GeoLite Country bucket is missing. Deploy the additive infrastructure through AWS/Web Release first." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
chmod 700 "$work_dir"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --retry 3 --retry-delay 5 --connect-timeout 15 --max-time 180 \
  --user "${MAXMIND_ACCOUNT_ID}:${MAXMIND_LICENSE_KEY}" \
  --output "$work_dir/country.tar.gz" \
  'https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz'
tar --extract --gzip --file "$work_dir/country.tar.gz" --directory "$work_dir" \
  --no-same-owner --wildcards '*/GeoLite2-Country.mmdb'
mapfile -t databases < <(find "$work_dir" -type f -name GeoLite2-Country.mmdb)
if [[ "${#databases[@]}" -ne 1 ]]; then
  echo "GeoLite Country archive must contain exactly one Country MMDB." >&2
  exit 1
fi
apps/backend/node_modules/.bin/tsx apps/backend/scripts/publish-geolite-country.ts "${databases[0]}" "$bucket"
