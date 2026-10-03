#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle_dir="${repo_root}/.cache/lambda-build"
mkdir -p "${bundle_dir}"
# Download once per job; every graph and bundle consumes these exact bytes.
curl --fail --silent --show-error --location \
  --retry 3 --retry-all-errors --retry-delay 2 --max-time 60 \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  --output "${bundle_dir}/rds-global-bundle.pem.download"
test -s "${bundle_dir}/rds-global-bundle.pem.download"
grep -q -- "-----BEGIN CERTIFICATE-----" "${bundle_dir}/rds-global-bundle.pem.download"
openssl crl2pkcs7 -nocrl -certfile "${bundle_dir}/rds-global-bundle.pem.download" \
  -out /dev/null
mv "${bundle_dir}/rds-global-bundle.pem.download" "${bundle_dir}/rds-global-bundle.pem"
