# Deploying the Operations staff training app to a dedicated host

This is an **opt-in, training-only** process. It does not deploy to or reconfigure the production Operations app, its database, its gateway, or its files. PRs #213 and #214 supply the guided tutorial and fictional data. The manual GitHub Actions workflow `Deploy Isolated Operations Training` installs a separate Docker Compose project on a host that an authorized operator has **already marked as dedicated to training**.

## Required infrastructure before dispatch

The training host must be a server you administer, with Docker Engine/Compose v2, Python 3, curl, adequate free disk, and a Linux login account that can use Docker. This does **not** make the app publicly reachable. Its Nginx gateway is bound to `127.0.0.1:3401`, deliberately inaccessible over the internet or LAN. For remote staff, provision a separate VPN, SSH forwarding, or reviewed TLS ingress with authentication and appropriate Allowed Origins/Hosts settings.

Provision the following host resources through your approved server administration process:

- A root-owned file `/etc/hiddenoasis-training-only-id` containing the exact line `ISOLATED_TRAINING_HOST_V1`. **Never place this marker on the production VPS merely to bypass the check.** The file signifies formal operator approval of this server specifically for training.
- An empty directory `/opt/hiddenoasis-training` owned by the dedicated deployment account, with directory permissions excluding untrusted accounts.
- The account's independent SSH public key in its authorized_keys, and a pinned host public key obtained through a trusted channel.
- The host's SSH port, which may differ from 22. The script does not set up SSH or grant sudo privileges.

## Set up the GitHub training environment

In GitHub, open the repository Settings > Environments and create an environment called `training`. Add deployment approval rules as appropriate. Set these **training-only** secrets; do not copy any existing production secrets:

| Secret | Meaning |
| --- | --- |
| `TRAINING_SSH_HOST` | Dedicated training server address/hostname |
| `TRAINING_SSH_USER` | SSH user allowed to deploy to /opt/hiddenoasis-training |
| `TRAINING_SSH_PORT` | SSH port, optional (default 22) |
| `TRAINING_SSH_HOST_KEY` | Pinned OpenSSH known_hosts line for that host and port |
| `TRAINING_SSH_PRIVATE_KEY` | Independent SSH private key matching its authorized_keys |
| `TRAINING_SESSION_SECRET` | Unique URL-safe random string of at least 48 characters |
| `TRAINING_INTEGRATION_API_KEY` | Independent URL-safe random string of at least 48 characters, never the production API key |

Use a cryptographically secure generator to produce the random secrets, such as `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`. Do not paste private keys, server addresses or secrets into ChatGPT.

The workflow will fail closed if the marker, SSH host key, credentials, or environment are missing. It does not create public ingress or DNS records.

## Manually deploy

After required code checks are green:

1. In GitHub, open Actions > **Deploy Isolated Operations Training** > Run workflow.
2. Select the reviewed `main` revision.
3. Enter the exact confirmation string `DEPLOY_ISOLATED_TRAINING_ONLY` and start.
4. Approve the `training` deployment environment if GitHub requests reviewer approval.
5. Follow the workflow logs for host marker verification, transfer, private secret provisioning, Compose build, and localhost health check.

The release is installed under `/opt/hiddenoasis-training/releases/<commit SHA>`, with a separate `.env.training.private` under a protected `shared` directory. The container volumes persist across training application restarts and subsequent releases. The script does **not** run against the main production Compose file.

The only port exposed by the training stack is the host's **loopback** `127.0.0.1:3401`. A staff member cannot open a public website merely by knowing a URL. An authorized trainer can verify the app through an SSH tunnel to the training host:

    ssh -L 3401:127.0.0.1:3401 <authorized-training-user>@<dedicated-training-host>

The trainer then opens `http://127.0.0.1:3401/login` and must see the **TRAINING ONLY** label before login.

## Acceptance after a deployment

1. Verify `/api/readyz` reports ready, the login page shows TRAINING ONLY, and the response header includes `X-Training-Environment: synthetic-isolated`.
2. Retrieve the private roster using the documented private-volume procedure; never upload it to GitHub or a shared drive.
3. Log in as a fictional Staff member and verify no management-only actions are available.
4. Log in as a fictional Supervisor or Manager and practise the popup-guided Tasks and Requests tutorials. Confirm the focus arrow does not cover fields.
5. Test My Work, Requests, Guest Matters, Maintenance, Projects, Marketing and Shift Handover on desktop and phone.
6. Confirm training-only integration isolation and that no production tasks, records, names, database names or external events appear.
7. Keep employee practice separate from certification. Viewing a tour is not a training pass.

### Important limitations

The workflow assumes a dedicated, prepared training host and *cannot* provide it, configure its DNS/VPN, or establish TLS automatically. Do not change its server marker check or localhost binding just to get a public link. An internet-facing training URL requires a separate reviewed ingress/authentication task.

The workflow neither restores nor copies production data. Its fictional records are seeded once and retained in separate Docker volumes. Back up or reset only those volumes as an explicit training-data operation.
