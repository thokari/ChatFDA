#!/usr/bin/bash
set -euo pipefail
: "${OS_PASS?Set OS_PASS in your environment}"
OS_USER="${OS_USER:-admin}"
OS_HOST="${OS_HOST:-https://localhost:9200}"

echo "# Cluster info"
curl -sS -k -u "$OS_USER:$OS_PASS" "$OS_HOST" | jq .

echo "# Indices"
curl -sS -k -u "$OS_USER:$OS_PASS" "$OS_HOST/_cat/indices?v"

echo "# drug-labels count"
curl -sS -k -u "$OS_USER:$OS_PASS" "$OS_HOST/drug-labels/_count?pretty"
