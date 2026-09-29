# EmailSender

EmailSender is a local app for preparing and sending individual attendance notices to parents. It imports Excel workbooks, matches students to parent email addresses by registration number, lets you review the message, and sends through your Gmail account. The website and sending service run on your computer.

**Repository:** [Cosmos-0118/EmailSender](https://github.com/Cosmos-0118/EmailSender) (`main`).

## Requirements

- Git and Node.js LTS for running from a source checkout; the managed installer can install missing tools
- A Gmail account that can use an app password
- Attendance and parent directory files in `.xlsx` format; see the [sample layouts](examples/README.md)

## Install and run

The installer downloads the app, adds an `emailsender` command, and starts it. You do not need to clone the repository first.

On macOS Terminal:

```sh
emailsender_installer="$(curl -fsSL https://raw.githubusercontent.com/Cosmos-0118/EmailSender/main/scripts/install.sh)" && test -n "$emailsender_installer" && bash -c "$emailsender_installer"
```

This keeps Terminal available for the installer if Homebrew needs to ask for your macOS administrator password.

The macOS installer uses Homebrew to install missing Git or Node.js tools and may request administrator access. It adds `~/.local/bin` to your shell profile; open a new terminal if `emailsender` is not yet on your `PATH`.

On Windows PowerShell:

```powershell
$installer = irm https://raw.githubusercontent.com/Cosmos-0118/EmailSender/main/scripts/install.ps1; if (-not $installer) { throw 'Installer download was empty' }; iex $installer
```

The Windows installer uses `winget` or Chocolatey for missing dependencies and adds `%LOCALAPPDATA%\EmailSender\bin` to your user `PATH`. Open a new PowerShell window if the command is not yet available.

After installation, start or update the managed app with:

```text
emailsender start
```

Each managed start fetches the default branch, resets local changes **inside the managed app checkout**, installs dependencies, builds, and opens the private local link. Do not store personal files or edits in that managed checkout. Attendance files and saved app data live separately.

The app listens on `127.0.0.1:43871`, but the bare address will not unlock it. Use the browser tab opened by the launcher or the private link printed in the terminal.

## Run from a source checkout

For development, you can run the repository directly. On macOS, use Terminal; on Windows, use PowerShell.

```sh
git clone https://github.com/Cosmos-0118/EmailSender.git
cd EmailSender
npm ci
npm run dev
```

`npm run dev` builds the website, starts the local service, and opens its private launch link in your browser. Leave the terminal running while using EmailSender. To start it again later, run `npm run dev` from the checkout. To update, stop the app and run `git pull --ff-only`, `npm ci`, then `npm run dev`.

## Send a mailing

1. Save your Gmail sender address and app password.
2. Import the attendance workbook. The app imports rows below 75%. Community Connect (`21GNP301L`) rows with 0% are excluded from messages by default, but can be included during review.
3. Import the parent directory. Records are matched by registration number. Review real name or email changes before accepting a replacement sheet; contacts absent from the new sheet remain saved.
4. Resolve data warnings and review the personalized draft and recipient list.
5. Send a test to an alternate email address. Check that it arrived and that its content is correct, then press **Verify test email**. Each test gets a unique subject so repeated tests appear separately in Gmail.
6. Open parent delivery and send. Each eligible student gets one separate email containing all included shortage subjects. Monitor delivery progress and resolve any uncertain outcome before resuming.

Gmail accepting a test means it accepted the message for delivery; it does not prove it arrived in the inbox. The verification button records your check of the received message.

## Local data and recovery

EmailSender stores sender credentials, parent records, attendance, drafts, and delivery history outside the Git checkout. Set `EMAILSENDER_DATA_DIR` to choose a different data directory. Defaults are:

- macOS: `~/Library/Application Support/EmailSender/data`
- Windows: `%LOCALAPPDATA%\EmailSender\data`

The local data file is encrypted with AES-256-GCM, and its key is stored in the operating system credential store. The browser also keeps an encrypted recovery snapshot in IndexedDB. Gmail receives email content and recipient addresses when messages are sent. Real workbooks under `Input/` are ignored by Git.

If you restore a browser snapshot after losing the local data file, previous delivery outcomes are marked uncertain. Check the sender's Gmail Sent folder, resolve each outcome in the app, and send and verify a fresh test before resuming. This prevents a restored snapshot from silently resending notices.

For app password setup, see [Google Account Help](https://support.google.com/accounts/answer/2461835).

## Development

```sh
npm test
npm run build
```

`npm test` runs the model checks. `npm run build` creates the production website in `dist/`.
