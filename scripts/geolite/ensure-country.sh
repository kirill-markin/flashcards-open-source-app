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

editions=(GeoLite2-Country GeoLite2-ASN)

check_edition() {
  apps/backend/node_modules/.bin/tsx apps/backend/scripts/check-published-geolite-country.ts \
    "$1" "$bucket" "$work_dir/$1.mmdb"
}

refresh_required=false
for edition in "${editions[@]}"; do
  if check_edition "$edition"; then
    continue
  else
    status=$?
  fi
  case "$status" in
    2|3)
      refresh_required=true
      ;;
    *)
      echo "Published $edition validation failed; release stopped. Inspect the error above; AccessDenied means the deploy role's IAM is wrong." >&2
      exit "$status"
      ;;
  esac
done

if [[ "$refresh_required" == true ]]; then
  bash scripts/geolite/refresh-country.sh
  for edition in "${editions[@]}"; do
    check_edition "$edition"
  done
fi
