#!/usr/bin/env bash
# Load the shared root .env so Cloudflare scripts use the same local operator config.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/root-env.sh"

load_root_env
