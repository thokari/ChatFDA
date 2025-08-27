#!/usr/bin/env bash
set -euo pipefail

: "${OS_PASS?Set OS_PASS (OpenSearch admin password) in your environment}"
OS_USER="${OS_USER:-admin}"
OS_HOST="${OS_HOST:-https://localhost:9200}"

CURL=(curl -sS -k -u "$OS_USER:$OS_PASS" -H 'Content-Type: application/json')

echo "Creating index: drug-labels"
"${CURL[@]}" -X PUT "$OS_HOST/drug-labels" --data-binary @opensearch/drug-labels.json
echo
echo "Creating index: drug-chunks"
"${CURL[@]}" -X PUT "$OS_HOST/drug-chunks" --data-binary @opensearch/drug-chunks.json
echo
echo "Creating index: ingest-jobs"
"${CURL[@]}" -X PUT "$OS_HOST/ingest-jobs" --data-binary @opensearch/ingest-jobs.json
echo
echo "Creating index: ingest-events"
"${CURL[@]}" -X PUT "$OS_HOST/ingest-events" --data-binary @opensearch/ingest-events.json
echo
echo "Done."
