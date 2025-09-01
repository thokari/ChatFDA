#!/usr/bin/env bash
set -euo pipefail

: "${OS_PASS?Set OS_PASS (OpenSearch admin password) in your environment}"
OS_USER="${OS_USER:-admin}"
OS_HOST="${OS_HOST:-https://localhost:9200}"

CURL=(curl -sS -k -u "$OS_USER:$OS_PASS")

for idx in ingest-jobs drug-labels drug-chunks ingest-events ask-metrics; do
  echo "Deleting index: $idx"
  "${CURL[@]}" -X DELETE "$OS_HOST/$idx" || echo "Index $idx did not exist or could not be deleted."
  echo
done

echo "Done."
