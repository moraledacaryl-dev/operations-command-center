#!/usr/bin/env bash
# Produce a private, validated, atomic upload archive for a production release.
set -Eeuo pipefail
umask 077

UPLOAD_PATH="${1:-}"
DESTINATION="${2:-}"
if [[ -z "$UPLOAD_PATH" || -z "$DESTINATION" ]]; then
  echo "ERROR | usage: bash backup_uploads.sh UPLOAD_DIR ARCHIVE_PATH" >&2
  exit 2
fi
if [[ ! -d "$UPLOAD_PATH" ]]; then
  echo "ERROR | upload directory does not exist: $UPLOAD_PATH" >&2
  exit 1
fi
if [[ ! -d "$(dirname "$DESTINATION")" ]]; then
  echo "ERROR | backup directory does not exist: $(dirname "$DESTINATION")" >&2
  exit 1
fi

# Keep the temporary archive beside its destination for an atomic rename.
TEMP_ARCHIVE="$(mktemp "${DESTINATION}.tmp.XXXXXXXX")"
trap 'rm -f -- "$TEMP_ARCHIVE"' EXIT

# BSD tar can synthesize AppleDouble entries from macOS file metadata.
# Keep the archive limited to actual source files on recovery workstations.
COPYFILE_DISABLE=1 tar -C "$UPLOAD_PATH" -czf "$TEMP_ARCHIVE" .
test -s "$TEMP_ARCHIVE"
# Read the entire compressed tar before publishing it, detecting malformed data.
tar -tzf "$TEMP_ARCHIVE" >/dev/null
mv -f -- "$TEMP_ARCHIVE" "$DESTINATION"
