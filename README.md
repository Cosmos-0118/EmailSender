# EmailSender

EmailSender is a local website for preparing and sending attendance notices. The web app and its sending service run on your computer; the app data directory is separate from the managed code checkout.

Prepare `.xlsx` files using the [sanitized layout examples](examples/README.md). Your real attendance and parent workbooks are ignored by Git under `Input/`.

## Install

The public repository URL is not configured yet. Once the repository owner and name are known, replace `OWNER/REPOSITORY` in the installer command below, or provide the repository URL with `EMAILSENDER_REPO_URL`.

### macOS

```sh
EMAILSENDER_REPO_URL=https://github.com/OWNER/REPOSITORY.git bash -c "$(curl -fsSL https://raw.githubusercontent.com/OWNER/REPOSITORY/main/scripts/install.sh)"
```

The installer bootstraps Homebrew with its official installer if missing, then uses it to install Git and Node.js when needed. Homebrew may request your macOS administrator password and command line tools. The installer adds `~/.local/bin` to the detected shell profile (`.zprofile`, `.bash_profile`, `config.fish`, or `.profile`) and updates the current session's `PATH`.

### Windows PowerShell

```powershell
& { $env:EMAILSENDER_REPO_URL = 'https://github.com/OWNER/REPOSITORY.git'; irm 'https://raw.githubusercontent.com/OWNER/REPOSITORY/main/scripts/install.ps1' | iex }
```

The installer uses `winget` (or Chocolatey) to install Git and Node.js LTS when needed. It adds `%LOCALAPPDATA%\EmailSender\bin` to the user `PATH`; open a new terminal if Windows has not refreshed `PATH`. If neither package manager is installed, install Git and Node.js LTS first.

## Start and update

After installation, run:

```text
emailsender start
```

Each start fetches the repository's default branch, resets local changes inside the managed checkout, installs dependencies, builds the app, and starts the local website at `http://127.0.0.1:43871`. The command opens that address in your browser. The managed checkout is application code; do not put personal files there.

Open the site through `emailsender start`. For a local source checkout, run `npm install` once and then `npm run dev`; this builds and opens the same private local website. An old development tab on port `5173` or the bare service address will not unlock your data. When running `npm run start` directly, use the private link printed in the terminal.

## Local data and privacy

The local service binds to `127.0.0.1:43871` and sends through Gmail SMTP over TLS. It stores credentials, parent records, attendance, drafts, and delivery history in `EMAILSENDER_DATA_DIR`, outside the managed Git checkout:

- macOS: `~/Library/Application Support/EmailSender/data`
- Windows: `%LOCALAPPDATA%\EmailSender\data`

The service encrypts its data file with AES-256-GCM and stores the encryption key in the operating system credential store. It also keeps an encrypted recovery snapshot in browser IndexedDB. Gmail receives the message content and recipient addresses when email is sent.

If the local data file is lost and you restore the browser snapshot, every recipient is marked as having an uncertain delivery outcome. Check the sender's Gmail Sent folder and resolve each recipient before sending a fresh test and resuming. This prevents a stale browser copy from silently resending notices.

The sender account needs a Gmail app password. Google explains how to create and use one in [Google Account Help](https://support.google.com/accounts/answer/2461835). A successful test means Gmail accepted the message; check the alternate inbox before sending to parents.

## Repository maintainers

Configure the public Git URL as `EMAILSENDER_REPO_URL` at install time. The launchers run `npm run build` and `npm run start`; the local web server binds to `127.0.0.1:43871` and reads `EMAILSENDER_DATA_DIR`.
