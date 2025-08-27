#!/usr/bin/env bash
set -euo pipefail

: "${OS_PASS?Set OS_PASS (OpenSearch admin password) in your environment}"
OS_USER="${OS_USER:-admin}"
OS_HOST="${OS_HOST:-https://localhost:9200}"

FILE="${1:-samples/drug.json}"
if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  ID="$(jq -r '.id // empty' "$FILE")"
else
  echo "warning: jq not found; pass ID as second arg" >&2
  ID="${2:-}"
fi

if [[ -z "${ID:-}" ]]; then
  echo "Could not determine document id. Install jq or pass it explicitly:" >&2
  echo "  $0 samples/drug_sample.json <id>" >&2
  exit 1
fi

echo "Indexing doc id: $ID from $FILE"
curl -sS -k -u "$OS_USER:$OS_PASS" -H 'Content-Type: application/json' \
  -X PUT "$OS_HOST/drug-labels/_doc/$ID" \
  --data-binary "@$FILE"

echo
echo "Verify:"
curl -sS -k -u "$OS_USER:$OS_PASS" "$OS_HOST/drug-labels/_doc/$ID" | sed 's/.*/&/'

echo
echo "Done."
