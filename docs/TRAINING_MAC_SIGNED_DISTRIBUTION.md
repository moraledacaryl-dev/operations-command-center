# Mac Operations Training — Signed Distribution Release Gate

This procedure is for the **offline, fictional-only** Hidden Oasis Operations Training app. The ordinary draft-PR Mac artifacts are **unsigned and not notarized**; successful CI packaging does not fix Gatekeeper's “damaged” or unidentified-developer warnings on a downloaded Mac app.

## What is implemented

The Mac workflow now has a **manual-only, main-branch-only** `sign-and-notarize` stage. It runs *after* both architecture-specific standalone application builds and their real local-backend smoke tests pass. It never runs automatically on PR builds, cannot run against other branches, and cannot proceed with missing credentials.

For each architecture (Apple Silicon `arm64` and Intel `x64`), the protected stage:

1. Downloads the matching **unsigned artifact from that exact GitHub Actions run**, rather than rebuilding or downloading a different revision.
2. Uses a temporary private keychain and an Apple **Developer ID Application** certificate to apply hardened-runtime code signatures to bundled Mach-O executables, libraries and the app itself.
3. Verifies code signatures and the configured Apple Team ID.
4. Submits the signed Mac app to Apple's **notarytool** for notarization and waits for the result.
5. **Staples** the accepted notarization ticket to the application and checks the staple and macOS Gatekeeper assessment.
6. Re-runs the **packaged real-HTTP, fictional-staff and manager workflow smoke** on the signed app, then uploads an independently named `SIGNED-NOTARIZED` ZIP.

This is a **prepared release workflow**, not a claim that signing/notarization has already occurred. We cannot run the stage until the owner has a valid Apple Developer ID and App Store Connect notary API credentials, configures a protected GitHub Environment and explicitly authorizes a main-branch release. Do not use the unsigned `Hidden-Oasis-Operations-Training-Mac-*` ZIPs as staff-ready distributions.

## Prerequisites (owner / repository administrator)

- Enroll in the Apple Developer Program and obtain a valid **Developer ID Application** signing certificate **with its private key**. Export to a password-protected `.p12` file. Do **not** commit it to GitHub or paste its contents into ChatGPT.
- Create an App Store Connect API key permitted to submit Developer ID notarization requests. Keep the `.p8` private key outside the repository; record the key ID, issuer ID and Apple Team ID.
- Configure a GitHub Actions Environment named **`training-distribution`**. Require owner approval for deployment and restrict deployment branches to `main`. Only trusted repository administrators should manage these secrets.
- Add the following seven **environment secrets** directly in GitHub's Secrets UI, not in the PR, code, chat, or CI logs:

| Environment secret | Value |
| --- | --- |
| `APPLE_DEVELOPER_ID_P12_BASE64` | Base64 of the complete password-protected Developer ID `.p12`, including its private key |
| `APPLE_DEVELOPER_ID_P12_PASSWORD` | The export password for the `.p12` |
| `APPLE_DEVELOPER_ID_APPLICATION` | Exact keychain identity name, e.g. `Developer ID Application: Your Company (TEAMID)` |
| `APPLE_TEAM_ID` | Apple Developer Team ID matching the certificate |
| `APPLE_NOTARY_KEY_ID` | App Store Connect API key ID |
| `APPLE_NOTARY_ISSUER_ID` | App Store Connect issuer ID |
| `APPLE_NOTARY_PRIVATE_KEY_BASE64` | Base64 of the original `.p8` API private key |

Generate Base64 on your own private computer; keep the raw files and output out of shell history, screenshots, support tickets, repositories and staff handouts. Credentials are never needed by the employee training app. The workflow imports them **only** into a temporary Mac runner keychain and temporary private files, then removes those materials after signing.

## Authorized release procedure

1. Obtain explicit owner approval **before merging** draft PR #222; completing CI is not merge approval.
2. Verify the approved commit and that all seven build/security/training workflows pass.
3. On the default `main` branch, open **GitHub → Actions → Build Mac Standalone Operations Training → Run workflow** and select `main`. The manual stage requires the protected `training-distribution` environment's reviewer approval.
4. Inspect the result: both `mac-training` jobs **and both `sign-and-notarize` jobs** must pass. Verify the output ZIPs have `SIGNED-NOTARIZED` in their artifact names. Unsigned package artifacts also remain in Actions for debugging; do not hand those to staff.
5. Test the **signed** arm64 ZIP on a clean Apple Silicon Mac and the signed x64 ZIP on a clean Intel Mac following [device acceptance](TRAINING_DESKTOP_DEVICE_ACCEPTANCE.md). In particular, verify that a normal double-click does **not** show a “damaged”/unidentified developer warning, the browser opens local training automatically, the trainer accounts guide opens, and the role-specific fictional practice survives restart.
6. Approve distribution to staff **only** after this physical-device acceptance. The release stage intentionally does not merge PRs, deploy the live Operations app, use production data, or publish a signed package automatically to an uncontrolled public location.

**Failure:** Missing credentials, failed Apple notarization, invalid staple, signature mismatch or failed real training smoke must block the signed artifact. Inspect only redacted runner output. If notarization rejects the bundle, review Apple's notary log privately and fix the nested signing or entitlements; do not bypass Gatekeeper globally.

## Windows

The Windows standalone installer is currently unsigned too, and SmartScreen warnings remain an independent distribution gate. The Mac Developer ID workflow does **not** sign Windows executables. Use an appropriate trusted Windows code-signing process and test on a real staff Windows PC before broad deployment.
