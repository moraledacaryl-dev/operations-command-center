# Standalone Operations Training — Device Acceptance Checklist

**Scope:** Hidden Oasis Operations Training **only**. This checklist is for the
offline Mac (Apple Silicon or Intel) and Windows x64 standalone training
installers built from draft PR #222. It is not permission to deploy production
Operations, install the live database, or use real guest/employee information.

**Release gate:** Automated CI must pass for the **exact commit** being tested.
The unsigned builds are for **owner-controlled testing only**; code-signing and
Mac notarization/Windows signing are required before general unsupervised
distribution. A passing CI job cannot prove Gatekeeper/SmartScreen acceptance or
first-open desktop behavior on a staff computer.

## Record the device and build

| Field | Fill in when testing |
| --- | --- |
| Tester and date | |
| Device, OS version and CPU | |
| Git commit SHA | |
| GitHub Actions workflow run and artifact | |
| Installed as normal user or administrator | |
| Internet on/off during test | |
| Result (PASS / FAIL / NOT TESTED) | |

Download only the named artifact from the verified GitHub Actions run. For Mac,
use **arm64** for Apple Silicon and **x64** for Intel. For Windows, use the
**Windows Standalone Installer**. Do **not** install Docker, Node, Python, a
database server, or developer tools on a staff computer.

## Verify the exact downloaded archive

Every new unsigned Mac or Windows CI artifact and every authorized signed-release
artifact includes a `.sha256` companion file. Download the **installer and its
matching checksum file from the same successful GitHub Actions run** before
testing; do not confuse PR unsigned archives with signed-release archives.

On Mac, put the downloaded `.zip` and its `.zip.sha256` together, then run:

```bash
shasum -a 256 -c Hidden_Oasis_Operations_Training_Mac_arm64.zip.sha256
```

For an Intel Mac, replace `arm64` with `x64`. On Windows PowerShell, put the
`.exe` and `.exe.sha256` together and run:

```powershell
$installer = ".\\Hidden_Oasis_Operations_Training_Windows_Standalone_Setup.exe"
$expected = ((Get-Content "$installer.sha256" -Raw).Trim() -split '\\s+')[0]
$actual = (Get-FileHash $installer -Algorithm SHA256).Hash
if ($actual -ine $expected) { throw "Installer checksum mismatch: do not install" }
"PASS: installer checksum matches the verified GitHub run"
```

The filename must match the downloaded artifact and the expected hexadecimal
hash must match. **Stop if the checksum fails.** A checksum detects a changed or
incomplete download; it does **not** replace signed publisher verification,
notarization, GitHub source review, or end-user security acceptance. The owner
or technical trainer can do this check before giving the installer to staff.

## Hands-on acceptance

Mark each item **PASS**, **FAIL**, or **NOT TESTED**. Retain screenshots/logs of
failures, but **never screenshot or export the full trainer password guide**.

1. **First launch:** Install/extract the downloaded build normally, launch
   **Hidden Oasis Training**, and verify the training browser opens by itself
   after the app reaches ready status. It must open
   `http://127.0.0.1:3401/training` or the local login that leads to it.
   No terminal, Docker, browser configuration, or hidden setup steps may be
   required of staff.
2. **Environment:** Confirm the `TRAINING ONLY` warning, fictional accounts,
   and fictional room/guest/task content. Verify there is no production
   login, real employee identity, or external Operations connection.
3. **Trainer handout:** Use **Trainer accounts** in the desktop launcher. It
   must open `PRIVATE_TRAINER_ACCOUNTS.txt`, a private, human-readable list
   grouped by department, containing 20 local fictional accounts. The trainer
   gives each trainee *only* that trainee's assigned fictional credentials.
   This complete file must never be hosted on the training website, emailed
   to staff, printed for public use, or included in a screenshot.
4. **Role access:** Log in with the fictional Front Desk **staff** account
   (reception-am). The app must land directly on training. Verify the staff
   can read assigned work but **cannot** create, approve, or verify a protected
   manager-only business operation.
5. **Scenario decisions:** Select a Front Desk scenario; intentionally give
   one wrong triage answer, then the corrected answer. Complete its fictional
   handover/documentation response. Verify helpful feedback, attempt tracking,
   and that the completed scenario appears in local progress.
6. **Real staff reading:** Complete **Task** and **Shift Handover** read-only
   investigations using their actual Operations tabs. For Front Desk, also
   complete the **Guest Matters** read-only investigation. Wrong status/urgency
   answers must fail, correct answers must pass, and the saved operational
   record must not be edited.
7. **Real saved staff action:** In the notification lesson, select an unread
   `[TRAINING] Daily notice practice` sample, open the real Notifications
   page, click **Mark read**, and return to **Verify saved read status**. It
   must pass only after the local backend has saved `read_at`.
8. **Maintenance scope:** Sign out and log in as fictional Maintenance staff
   (technician). The **Maintenance** work-order reading exercise must be
   available, while Front Desk Guest Matters should not be shown as a
   Maintenance exercise. No work-order Verify/Mark done button should be
   offered to ordinary staff.
9. **Lead/manager practice:** Sign in with the trainer-assigned fictional
   Supervisor/Lead and Manager accounts. Confirm the manager-only saved
   workflows create or transition **fictional** records, show the actual
   saved change, and do not elevate the ordinary staff account. Follow the
   on-screen action coach and use only the local training DB.
10. **Results:** Use **Export my results (CSV)**. The file should include
    distinct rows for completed scenario lessons, four types of read-only
    investigations where applicable, saved notification acknowledgement, and
    any authorized workflow exercises. Do not claim CSV evidence is an
    authenticated examination or proof that the trainee personally clicked a
    tab.
11. **Restart and updates:** Close the launcher; reopen it. The previous
    fictional passwords, data, selected roles, completed exercises, and
    private readable trainer guide should remain available. Reinitialization
    may add missing fictional notification samples, but must not reset old
    records or the randomized credential roster.
12. **Offline:** After the first successful setup, disconnect Internet and
    repeat loading training, making a fictional local read, and completing a
    scenario. Only `127.0.0.1` should be needed for app-to-API traffic.
13. **Stop and reopen:** Use **Stop** and close the app. Verify the local
    services stop cleanly; reopen and verify the app starts again without
    deleting progress. If port 3401/8401 is occupied, report the error
    rather than attempting to connect to a different/production server.
14. **Small window and readability:** Check a smaller laptop window, scrolling
    through long training cases, button visibility, text wrapping, and
    keyboard navigation. The trainee must be able to read instructions and
    return from actual Operations modules to the lesson.

## Platform-specific gate

**Mac (Apple Silicon / Intel):** The app is currently **unsigned and not
notarized**. Record any “damaged,” “unidentified developer,” or other Gatekeeper
dialog verbatim; a successful CI build does **not** resolve this on a user
device. Do not ask staff to bypass endpoint policies or disable Gatekeeper
globally. Authorized owner test exceptions are separate from distribution
approval. A broadly distributable build requires an Apple Developer ID
certificate, hardened-runtime signing of all nested executables and bundles,
notarization, and stapling followed by a fresh-device acceptance test.

**Windows 10/11 x64:** The per-user installer and shortcut should work without
Docker/WSL/Python/Node. Record SmartScreen/Defender or organizational
installation restrictions. **Regular PR output remains unsigned.** An optional
main-branch/manual/protected Windows Authenticode stage is documented at
[Signed Windows Distribution](TRAINING_WINDOWS_SIGNED_DISTRIBUTION.md).
When testing its independently named signed installer, inspect
**Properties → Digital Signatures** to confirm a valid trusted Hidden Oasis
publisher identity and timestamp, and test the install/uninstall on a clean
device. **Even a valid signature does not guarantee SmartScreen reputation**,
so do not instruct staff to bypass managed-machine security. A real staff-PC
acceptance check is still required for broad rollout.

## Failure record and release decision

For each failure, record: platform, build SHA, exact step, observed vs expected
result, error text, and whether a clean restart reproduces it. Attach
**redacted** screenshots and the desktop Training logs where safe; remove
fictional passwords and local account secrets before sharing.

- **PASS for owner testing:** CI green for the tested SHA; no severe blocker in
  the relevant Mac or Windows packaged backend; first launch, local login,
  role-scoped reading/action and restart work on the actual test device.
- **PASS for staff distribution:** All above, plus correctly signed/notarized
  installers accepted by a clean device without security bypasses, and
  operator-approved installation/trainer instructions.
- **FAIL / hold:** Any production connection, live-data exposure, unauthorised
  status change, unreadable/missing fictional roster, data loss on restart, or
  installer blocked by platform security on the intended staff machine.

**Remember:** One app installation includes all role-based lessons, but the
fictional data and progress are **local to that computer**. No shared
cross-device progress or production sync is implied.
