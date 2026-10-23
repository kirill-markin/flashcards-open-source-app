#!/bin/sh
set -eu
managed_node="$1"
shift
node_path="$(NODE_OPTIONS='' "$managed_node" /opt/nibomo-node/extract.cjs)"
exec "$node_path" --require /opt/nibomo-node/verify.cjs "$@"
