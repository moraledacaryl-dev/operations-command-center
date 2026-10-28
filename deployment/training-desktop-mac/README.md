# Hidden Oasis Operations Training — Standalone Mac

**Standalone test build** for Intel or Apple Silicon Mac. Runs the same guided, role-scoped Operations application and synthetic hotel workflows as Windows. No Docker, Python, Node or additional runtime installations required.

### Installation

1. Download the zip that matches **About This Mac → Chip**: Apple Silicon = arm64; Intel = x64.
2. Unzip and drag **Hidden Oasis Training.app** into Applications (or keep it in Downloads for a quick owner test).
3. Double-click the app. It initializes a **new fictional database** inside this user's `~/Library/Application Support/HiddenOasis/OperationsTraining` directory. Start/Stop/Open and Trainer Accounts controls live in the desktop window.
4. The local browser opens `http://127.0.0.1:3401/login` only after the service reports readiness.
5. Click **Trainer accounts** to open a **private, readable list grouped by department and role**. Copy only the assigned fictional email and password for the trainee. Do not distribute the complete list.

**Ordinary PR build artifacts are unsigned and not notarized.** macOS Gatekeeper may prevent opening them, especially immediately after an internet download. A separately protected, manual main-branch release workflow can Developer-ID-sign, Apple-notarize and staple both architectures once the owner configures Apple signing credentials; see [Signed Mac Distribution](../../docs/TRAINING_MAC_SIGNED_DISTRIBUTION.md). This signing stage is not active during PR testing and must pass before general staff distribution. For owner testing, only after confirming the app came from this project's trusted GitHub run, use Finder → Control-click the app → Open, or follow System Settings → Privacy & Security guidance. Do not disable Gatekeeper globally or instruct staff to defeat an organization’s endpoint controls. A code-signed/notarized release is needed before broad distribution.

### Security, scope, and persistence

- Private localhost-only ports `127.0.0.1:3401` and `127.0.0.1:8401`; no LAN exposure.
- Exactly 20 **fictional** users, including reception, housekeeping, café, kitchen, maintenance, security, marketing and management, generated on first launch with unique random demo passwords.
- **One application, role-specific training.** The login controls visible work and interactive lessons.
- No production PostgreSQL database, real records, shared secrets or live staff accounts are packaged. No external Operations integrations are configured.
- Private session keys and practice records persist between sessions and are not deleted automatically when the app is closed. The trainer's readable credentials guide is generated locally from the private JSON roster and refreshed when necessary; the guide never appears on the sign-in website.
- The data is **local to that Mac**; no shared progress among staff machines.
- Do not enter actual guest or employee data in a local training environment.
- Minimum macOS 13; test on current supported macOS. Dedicated x64 and arm64 archives; do not mix architectures.

### Verification

CI workflow `.github/workflows/build-mac-training.yml` packages arm64 and Intel apps separately and verifies the packaged Mac Python backend migrations, 20 fictional accounts, Next frontend, API proxy, and staff and manager login on each runner. GUI first-open, Gatekeeper dialogs and user-specific environmental issues still require testing on a physical Mac.

If startup fails, choose **Training logs** to open `~/Library/Application Support/HiddenOasis/OperationsTraining/logs`; do not delete the training data folder.
