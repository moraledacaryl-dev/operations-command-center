# Hidden Oasis Operations Training — Standalone Windows edition

**Goal:** Trainer/staff uses an ordinary Windows x64 installer and the **Hidden Oasis Training** desktop shortcut. No Docker, Python, Node, WSL, or .NET installation is needed by the end user. The installer bundles private native runtimes and the training-only Next.js app.

## Roles and isolation

- **One installation serves every role.** The same launcher runs the entire command center, and each fictional login (Reception, Housekeeping, Café, Kitchen, Maintenance, Security, Marketing, Supervisors, Management) determines the user's view and permission boundaries.
- Exactly 20 randomized fictional accounts are generated at **first launch** on the local device. Neither passwords nor a seeded database are shipped inside the installer.
- Fictional guest, task, project, shift, approval, and request data is independently seeded on each Windows computer. Desktop training never reads the live Operations PostgreSQL database.
- Trainer credentials are at `%LOCALAPPDATA%\HiddenOasis\OperationsTraining\private\accounts\PRIVATE_training_accounts.json`. The shortcut's **Trainer accounts** button opens the private, department-grouped `PRIVATE_TRAINER_ACCOUNTS.txt` guide derived from that file. Give staff only the demo credentials intended for their role.
- Practice records persist after stopping and restarting the desktop launcher and across program updates. The trainer-only credentials guide is regenerated from the existing private roster if needed; it does not reset passwords. **Uninstall does not delete practice records.**
- Uses localhost only (`127.0.0.1:3401` web UI and `127.0.0.1:8401` backend). Does not expose training on LAN or the Internet.
- Independent randomly generated session/integration keys; no production credentials or connections.

## Staff operation

1. Install `Hidden_Oasis_Operations_Training_Windows_Standalone_Setup.exe` by double-clicking the installer.
2. Launch **Hidden Oasis Training** from the desktop shortcut. The app initializes itself and opens the fictional training login automatically.
3. Sign in with the assigned fictional training account. Lessons and permissions follow the role.
4. During a slow first launch, click **Cancel setup** to stop initialization safely; afterward **Start training** can retry. When finished, click **Stop** or close the launcher. Practice records are preserved.
5. If the training window shows a startup problem, click **Training logs** to open the local diagnostic folder without needing a terminal or Windows command prompt.

**Do not share the full trainer roster with staff.** No real guest data should be entered in this installation.

## Installation caveats

- Windows 10/11 x64 (modern supported builds), normal user install; sufficient free disk (allow at least 2 GiB).
- Regular PR artifacts are **unsigned**. Windows SmartScreen may warn; do not bypass organizational endpoint security policies. A separate **manual, protected, main-only** stage can produce a correctly Authenticode-signed installer **after** the owner configures a trusted publisher certificate and authorizes the release. This has not been executed; see [Signed Windows Distribution](../../docs/TRAINING_WINDOWS_SIGNED_DISTRIBUTION.md). A valid signature alone does not guarantee SmartScreen reputation or a warning-free first install.
- Test on an actual Windows PC before broad staff rollout. The GitHub CI runs a real Windows packager and functional manager/staff API login, but cannot simulate all staff endpoint security policies or desktop interactions.
- Since the program is localhost-only, installing on one receptionist's PC does **not** create a central website accessible to everyone. To support multiple PCs simultaneously with shared training progress, deploy a separately secured shared training server.
- A separate installer is needed for Windows ARM64, macOS, or Linux.

## Source/build

GitHub Actions workflow: `.github/workflows/build-windows-training.yml`

1. Build the training-enabled standalone Next.js frontend on a Windows runner.
2. Freeze Python 3.12 application into native Windows executable with PyInstaller.
3. Bundle Node 24 from GitHub Actions, not from end-user machine.
4. Compile a self-contained .NET 8 WinForms controller with automatic startup, Start/Stop/Open, trainer accounts, and a one-click Training logs folder.
5. Create a per-user Inno Setup executable installer.
6. Run real Windows backend migrations, data seeding, frontend health checks and sample role logins before releasing artifact.

The entire app is synthetic-data-only; it does not modify the online production application.

### Interrupted first-time setup recovery

If the **first** startup is cancelled or interrupted during initial migration or fictional account creation, click **Start training** again. A new installation journal allows only an incomplete first launch to be retried. It preserves partial databases and randomized private account files under `%LOCALAPPDATA%\\HiddenOasis\\OperationsTraining\\recovery\\interrupted-first-launch-*`, then creates a new fictional set. Trainer passwords can change after recovering an incomplete first launch; read them through **Trainer accounts** after successful setup.

Existing fully initialized training data is never reset. Unexpected files, uploads, or an installation without a valid first-launch journal block automatic recovery. Use **Training logs** and contact the owner; do not delete or rename training folders. This feature does not fix hardware failures, corrupted completed databases, SmartScreen warnings, or unsigned distribution.
