# Windows Operations Training — Signed Installer Release Gate

This is **optional protected distribution tooling**, not a production deployment or claim that a signed Windows training installer exists. Draft PR #222 and regular build checks continue to produce an **unsigned, standalone, offline** Windows x64 installer. No Docker, Node, Python or WSL installation is needed by trainees.

## Protected Windows signing stage

The existing Windows Actions workflow now has `sign-windows`, which is **skipped for pull requests** and allowed only for an explicitly triggered workflow on `main` with reviewer approval in the GitHub `training-distribution` Environment. If signing credentials are absent or invalid, the stage fails closed. The build workflow validates this refusal using no credentials.

After the real Windows frozen API + Next frontend + 20 fictional role logins + protected workflows pass on CI, the regular job archives the exact `dist/desktop` payload as a short-lived artifact. The protected signing job downloads that payload **from the same workflow run** and:

1. Imports the approved code-signing certificate into the ephemeral Windows runner's **current-user certificate store**. Private PFX bytes are written only to a temporary runner file, deleted after import, and never placed in the training app, its ZIP, Git commits, workflow logs, or command-line password arguments.
2. Signs the generated **HiddenOasisTraining.exe** desktop launcher and **training-api.exe** frozen backend, using Microsoft Authenticode SHA-256 and an RFC 3161 trusted timestamp. It retains the bundled Node executable's valid original publisher signature when available, or signs its packaged copy if necessary.
3. Requires a valid signing certificate thumbprint and timestamp on both generated entry points. These are the executables created by Hidden Oasis; third-party libraries generally keep their original signatures.
4. Recompiles **the exact same saved training payload** with Inno Setup's `SignTool` and `SignedUninstaller=yes`, so Inno signs its Setup executable, embedded uninstaller, and temporary self-copies together (not just the outer installer after compilation).
5. Verifies Windows Authenticode identity, signature, and timestamp on the installer; uploads an explicitly named `Windows-SIGNED-Installer` artifact only if every check passes.

This path is an exportable-PFX option. If the certificate's key is hardware-backed or held by a managed service, adapt the signing adapter with the approved provider instead of weakening the protected release gate.

## Owner actions before a signed release

1. Obtain an authentic, trusted **Windows code-signing** publisher certificate (with an exportable PFX and private key when using this implementation). A self-signed certificate does **not** establish trusted-publisher reputation.
2. In GitHub **Settings → Environments**, configure `training-distribution` to require owner approval and permit deployments only from `main`. Restrict who can update the environment or its secrets.
3. In that **environment's secrets** section, set:
   - `WINDOWS_CODESIGN_PFX_BASE64` — Base64 of the password-protected PFX containing the code-signing certificate and private key
   - `WINDOWS_CODESIGN_PFX_PASSWORD` — that PFX's export password
   - `WINDOWS_CODESIGN_THUMBPRINT` — the certificate's exact 40-digit SHA-1 thumbprint (used only to select the authorized certificate; file signatures use SHA-256)
4. Keep the raw PFX, its password, and base64 outside this chat, code, tickets, screenshots, and staff accounts. Never add them as source files or release assets.
5. **Do not merge draft PR #222 merely to turn on signing.** Obtain explicit owner merge approval first; review all CI outcomes for the approved revision. When main contains the approved build, use **GitHub → Actions → Build Windows Standalone Training Installer → Run workflow** on `main` and approve the protected environment.
6. Confirm that both `windows-training` and `sign-windows` pass, and download **only** `Hidden-Oasis-Operations-Training-Windows-SIGNED-Installer` for potential distribution. Regular unsigned artifact output remains intentionally named and must not be mistaken for the signed package.
7. Test the signed installer, actual sign-in, operator account handout, department isolation, browser auto-open, offline behavior, practice progress persistence, and uninstall/reinstall on a clean Windows 10/11 x64 test PC using [device acceptance criteria](TRAINING_DESKTOP_DEVICE_ACCEPTANCE.md).

## SmartScreen limitation

**A valid code signature does not guarantee that SmartScreen will stop warning.** Windows checks both publisher reputation and the new file's download reputation, so an authentic newly signed installer can still show an unrecognized-app warning until reputation builds. Do not tell employees to bypass managed-device security policies. If this is unacceptable for nontechnical staff, consider a controlled enterprise deployment process or a verified Microsoft Store distribution after independent feasibility review.

The Mac notarization and Windows signing gates are **separate**, and neither can connect to the production Operations database. The Windows signing job does not access production credentials, change an existing local SQLite database, push anything to production, or deploy the training app automatically.
