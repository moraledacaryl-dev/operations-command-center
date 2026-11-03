#!/usr/bin/env bash
# Produce a distributable Developer-ID-signed and Apple-notarized Mac training app.
# Intentional manual main-branch release only; never run this with PR credentials.
set -euo pipefail
umask 077

: "${1:?Pass the extracted Hidden Oasis Training.app path}"
: "${2:?Pass arm64 or x64 release architecture}"
APP="$1"
ARCH="$2"
if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" ]]; then
  echo "REFUSED: unknown Mac training architecture" >&2; exit 2
fi
if [[ "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" || "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo "REFUSED: only manual main-branch distribution is permitted" >&2; exit 2
fi
for name in APPLE_DEVELOPER_ID_P12_BASE64 APPLE_DEVELOPER_ID_P12_PASSWORD \
  APPLE_DEVELOPER_ID_APPLICATION APPLE_TEAM_ID APPLE_NOTARY_KEY_ID \
  APPLE_NOTARY_ISSUER_ID APPLE_NOTARY_PRIVATE_KEY_BASE64; do
  if [[ -z "${!name:-}" ]]; then
    echo "REFUSED: required Apple distribution credential is not configured: $name" >&2; exit 2
  fi
done
if [[ -L "$APP" || ! -d "$APP/Contents/MacOS" || ! -d "$APP/Contents/Resources" ]]; then
  echo "REFUSED: invalid Mac training application bundle" >&2; exit 2
fi
if [[ "$(basename "$APP")" != "Hidden Oasis Training.app" ]]; then
  echo "REFUSED: unexpected Mac application name" >&2; exit 2
fi
command -v codesign >/dev/null
command -v xcrun >/dev/null
command -v security >/dev/null
command -v ditto >/dev/null

WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ho-training-sign.XXXXXXXX")"
KEYCHAIN="$WORK/training-sign.keychain-db"
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
printf '%s' "$APPLE_DEVELOPER_ID_P12_BASE64" | base64 -D > "$WORK/developer-id.p12"
printf '%s' "$APPLE_NOTARY_PRIVATE_KEY_BASE64" | base64 -D > "$WORK/AuthKey.p8"
KEYCHAIN_PASSWORD="$(openssl rand -hex 32)"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
security set-keychain-settings -lut 3600 "$KEYCHAIN" >/dev/null
security import "$WORK/developer-id.p12" -k "$KEYCHAIN" \
  -P "$APPLE_DEVELOPER_ID_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "$APPLE_DEVELOPER_ID_APPLICATION" >/dev/null

# The bundled Node runtime requires JIT, and frozen Python bundles load their
# own native libraries. Use explicit narrow runtime entitlements rather than
# disabling code-signature validation on the machine.
cat > "$WORK/runtime-entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
PLIST

# Sign every Mach-O nested dependency individually first; then seal the outer
# .app. Do not rely on --deep as a substitute for nested-binary signing.
SIGNED=0
while IFS= read -r -d '' target; do
  if [[ -L "$target" ]]; then continue; fi
  description="$(file -b "$target")"
  if [[ "$description" == *"Mach-O"* ]]; then
    codesign --force --timestamp --options runtime \
      --entitlements "$WORK/runtime-entitlements.plist" \
      --keychain "$KEYCHAIN" --sign "$APPLE_DEVELOPER_ID_APPLICATION" "$target"
    SIGNED=$((SIGNED+1))
  fi
done < <(find "$APP/Contents" -type f -print0)
if [[ "$SIGNED" -lt 3 ]]; then
  echo "REFUSED: signed fewer than three expected native executables" >&2; exit 2
fi
codesign --force --timestamp --options runtime \
  --entitlements "$WORK/runtime-entitlements.plist" \
  --keychain "$KEYCHAIN" --sign "$APPLE_DEVELOPER_ID_APPLICATION" "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -F "TeamIdentifier=$APPLE_TEAM_ID" >/dev/null
echo "PASS: signed $SIGNED nested native files and the Mac app with Developer ID"

UNSTAPLED="$WORK/Hidden_Oasis_Training_for_notarization.zip"
ditto -c -k --keepParent "$APP" "$UNSTAPLED"
xcrun notarytool submit "$UNSTAPLED" \
  --key "$WORK/AuthKey.p8" --key-id "$APPLE_NOTARY_KEY_ID" \
  --issuer "$APPLE_NOTARY_ISSUER_ID" --wait --output-format json > "$WORK/notarization-result.json"
# Explicitly require Apple's Accepted verdict; a successful CLI invocation
# alone is not the distribution acceptance decision.
python3 - "$WORK/notarization-result.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as stream:
    outcome = json.load(stream)
if outcome.get("status") != "Accepted":
    raise SystemExit("REFUSED: Apple notarization status was not Accepted")
print("PASS: Apple notarization Accepted")
PY
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"
spctl --assess --type execute --verbose=4 "$APP"

OUTPUT="${GITHUB_WORKSPACE:-$PWD}/Hidden_Oasis_Operations_Training_Mac_${ARCH}_SIGNED_NOTARIZED.zip"
ditto -c -k --keepParent "$APP" "$OUTPUT"
unzip -t "$OUTPUT" | tail -n 2
shasum -a 256 "$OUTPUT" | awk '{print $1}' | while read -r digest; do
  printf '%s  %s\n' "$digest" "$(basename "$OUTPUT")" > "$OUTPUT.sha256"
done
cat "$OUTPUT.sha256"
echo "PASS: notarized/stapled Developer ID Mac training archive for $ARCH"
