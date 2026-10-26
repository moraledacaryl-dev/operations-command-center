# Co-hosted Operations training on the existing Hidden Oasis VPS (Docker-free)

**Pre-install runtime check:** The bundled wheelhouse is built for `x86_64`, and the frontend systemd unit explicitly runs `/usr/bin/node`. Confirm `uname -m` reports `x86_64` and `/usr/bin/node --version` reports `v24.x`. The installer refuses mismatches before creating training directories or units. Do not install a different global Node version or change production Node binaries just to bypass this prerequisite.

**Why this path exists:** The current VPS already hosts Operations, Accounting, POS, Staff, Inventory, PostgreSQL and Nginx through systemd; it has 2 CPUs, ~3.7 GiB RAM with ~1.9 GiB available, and ~18 GiB free on its 75 GiB root disk. It has **no Docker and no swap**. Building Next.js on the VPS could disrupt production, so the [Build Native Operations Training Release] GitHub workflow builds the entire frontend on a **GitHub runner** and packages pinned Python wheels. The VPS only installs offline runtime dependencies.

## Safety boundaries

- First install only; stops if training data, services, code directory, or ports already exist.
- Uses **new** `operations-training-backend` (127.0.0.1:8401) and `operations-training-frontend` (127.0.0.1:3401) systemd units, not the existing `operations-*` production units.
- The database is synthetic SQLite at `/var/lib/hiddenoasis-training/data/operations_training_demo_main.sqlite`, not PostgreSQL; all 20 randomly generated user passwords are stored in a separate private file.
- Source code is installed into a separate `/opt/hiddenoasis-training` directory; uploads and cache are separate.
- New 48+-character random session/integration secrets are generated locally. **Never copy** production secrets or real guest data.
- No changes to Nginx, DNS, production services, database, API keys, or other application configurations.
- Services have 384 MB maximum RAM each, 65% CPU quotas and elevated OOM scores so the kernel favors production processes if memory pressure occurs. Performance limits are subject to systemd kernel support; verify them after installation.
- Build-time `NEXT_PUBLIC_TRAINING_MODE=true` displays a permanent fictional-data banner; the regular Operations frontend remains disabled.
- The ports bind only to `127.0.0.1`. There is **no public training URL** or open staff access until separate approval, a proper HTTPS reverse proxy, and authentication are implemented.
- The first-install script rejects hosts with insufficient resources or active training ports, and refuses a second install. A separate versioned update/rollback mechanism will be needed for upgrades; do **not** re-run the first-install script.

## 1. Build artifact in GitHub, off the VPS

After the training-native build workflow has passed CI and been merged, open GitHub Actions → **Build Native Operations Training Release** → **Run workflow** at `main`.

The workflow builds a versioned archive `operations-training-native-<SHA>.tar.gz` and SHA-256 file. Download both from the workflow's **operations-training-native-<SHA>** artifact. The artifact expires after 14 days and must be extracted locally to obtain the .tar.gz and .sha256 files.

You can build/test this package on your own computer without changing production.

## 2. Safely transfer to VPS

From the computer containing the downloaded archive and checksum, transfer the files to a private temporary directory on the VPS using an approved SSH/SCP login. Never upload training passwords or production secrets in this step.

For example (replace the angle-bracket placeholders locally, *not in a shared chat*):

    scp operations-training-native-<SHA>.tar.gz* <authorized-user>@<server>:/tmp/

On the VPS, in the directory containing the archive and checksum:

    sha256sum -c operations-training-native-<SHA>.tar.gz.sha256

**Stop if checksum verification fails.** Inspect the script in the repository before running it.

## 3. First installation only

The installer is included inside the verified tarball. On the VPS, extract **only its installer script** into a new temporary directory, then execute it against the same checksum-verified archive:

    mkdir -p /tmp/operations-training-native-installer
    tar -xzf /tmp/operations-training-native-<SHA>.tar.gz \
      -C /tmp/operations-training-native-installer ./deployment/training-native/install-first.sh

    sudo bash /tmp/operations-training-native-installer/deployment/training-native/install-first.sh \
      /tmp/operations-training-native-<SHA>.tar.gz INSTALL_NEW_ISOLATED_TRAINING_ONLY

**Do not run this yet** until the native build PR passes and the operator has verified the artifact and application preflight. The installer checks `operations-backend` and `operations-frontend` are active, RAM, disk, free ports, and that no previous training install exists. It creates the private service identity, filesystem paths, separately seeded training DB, and two new systemd units. It never changes Nginx or starts/restarts any existing production service.

If anything fails, stop: do not erase data or improvise destructive fixes. The script deliberately does not overwrite a partially initialized training instance.

## 4. Read-only checks afterward

    sudo bash /opt/hiddenoasis-training/current/deployment/training-native/verify-only.sh
    systemctl status operations-training-backend operations-training-frontend --no-pager
    systemctl show operations-training-backend -p MemoryMax -p CPUQuotaPerSecUSec
    systemctl show operations-training-frontend -p MemoryMax -p CPUQuotaPerSecUSec
    ss -ltn | grep -E ':3401|:8401'

The verifier tests isolated SQLite records, 20 synthetic accounts, API readiness, same-origin proxy, login TRAINING ONLY label, and the original production Operations services.

Credentials are protected at `/var/lib/hiddenoasis-training/private/accounts/PRIVATE_training_accounts.json` (root/training-user access only). **Do not paste them into ChatGPT, tickets or GitHub.** Give each employee only their assigned fictional login.

## 5. Test privately via SSH tunnel

From a trainer's computer:

    ssh -L 3401:127.0.0.1:3401 <authorized-user>@<server>

Open `http://127.0.0.1:3401/login` on the trainer's computer. Check the TRAINING ONLY banner and confirm the guided popups/arrows work. You can begin supervised testing with fictional guest matters, tasks and approvals. Do not enter any real business data.

**Do not set up `training.hiddenoasis.app` immediately.** That requires a separate, authenticated HTTPS ingress plan, security verification of public origins/hosts, server load testing, and staff-device acceptance.

## Remaining acceptance

This design has not been installed on the actual VPS by the code author. A successful GitHub build is **not** a live server deployment. Confirm available RAM/disk immediately before starting. Verify no impact on the five production systems during a private pilot, and record a production backup baseline before changes to shared Nginx/DNS.
