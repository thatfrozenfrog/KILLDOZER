#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-${VERSION:-}}"
CHANGELOG_FILE="${2:-CHANGELOG.md}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [changelog_file]" >&2
  exit 1
fi

VERSION="${VERSION#v}"

if [ ! -f "$CHANGELOG_FILE" ]; then
  exit 0
fi

awk -v ver="$VERSION" '
  $0 ~ "^## (v)?" ver "([[:space:]]|$)" { found=1; next }
  /^## / { if (found) exit }
  found { lines[++n] = $0 }
  END {
    start = 1
    while (start <= n && lines[start] ~ /^[[:space:]]*$/) start++
    end = n
    while (end >= start && lines[end] ~ /^[[:space:]]*$/) end--
    for (i = start; i <= end; i++) print lines[i]
  }
' "$CHANGELOG_FILE"
