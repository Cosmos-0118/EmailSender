#!/usr/bin/env bash
set -euo pipefail

APP_NAME="EmailSender"
DEFAULT_REPO_URL="https://github.com/Cosmos-0118/EmailSender.git"
REPO_URL="${EMAILSENDER_REPO_URL:-$DEFAULT_REPO_URL}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer supports macOS. On Windows, use the PowerShell installer." >&2
  exit 1
fi

step() {
  printf '\n[%s/4] %s' "$1" "$2"
  if [[ -t 1 ]]; then
    for _ in 1 2 3; do printf '.'; sleep 0.12; done
  fi
  printf '\n'
}
fail() { printf '\nEmailSender setup stopped: %s\n' "$1" >&2; exit 1; }
installer=""
temp_checkout=""
trap 'result=$?; if [[ -n "$installer" ]]; then rm -f "$installer"; fi; if [[ -n "$temp_checkout" ]]; then rm -rf "$temp_checkout"; fi; if [[ $result -ne 0 ]]; then printf "EmailSender setup failed. Fix the error above and run the installer again.\\n" >&2; fi' EXIT

printf '\n  E M A I L S E N D E R\n  Local setup for macOS\n'

bootstrap() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1 && "$tool" --version >/dev/null 2>&1; then return; fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  if command -v "$tool" >/dev/null 2>&1 && "$tool" --version >/dev/null 2>&1; then return; fi
  if ! command -v brew >/dev/null 2>&1; then
    if [[ ! -t 0 ]]; then
      echo "Homebrew is missing and needs an interactive terminal to request the macOS administrator password. Run this installer from Terminal." >&2
      exit 1
    fi
    echo "Homebrew is missing. Its official installer may request your macOS administrator password to install command line tools."
    installer="$(mktemp)"
    curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
    /bin/bash "$installer"
    rm -f "$installer"
    installer=""
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    if ! command -v brew >/dev/null 2>&1; then
      echo "Homebrew installation did not finish successfully." >&2
      exit 1
    fi
  fi
  brew install "$tool"
  if ! command -v "$tool" >/dev/null 2>&1 || ! "$tool" --version >/dev/null 2>&1; then
    fail "$tool was installed but is not available yet. Open a new Terminal window and rerun setup."
  fi
}

step 1 'Checking tools'
bootstrap git
bootstrap node
command -v npm >/dev/null 2>&1 || fail 'Node.js is installed but npm is missing. Reinstall Node.js LTS and retry.'

DATA_ROOT="${HOME}/Library/Application Support/${APP_NAME}"
BIN_DIR="${HOME}/.local/bin"
CHECKOUT="${DATA_ROOT}/app"
step 2 'Downloading EmailSender'
mkdir -p "$DATA_ROOT" "$BIN_DIR"
if [[ -d "$CHECKOUT/.git" ]]; then
  current_origin="$(git -C "$CHECKOUT" remote get-url origin 2>/dev/null)" || fail "Cannot read the existing checkout at $CHECKOUT"
  [[ "$current_origin" == "$REPO_URL" ]] || fail "The existing checkout at $CHECKOUT points to $current_origin. Move it aside before installing."
else
  if [[ -e "$CHECKOUT" ]]; then
    echo "Refusing to replace an existing non-Git directory: $CHECKOUT" >&2
    exit 1
  fi
  temp_checkout="$(mktemp -d "$DATA_ROOT/.app-download.XXXXXX")"
  git clone --depth 1 "$REPO_URL" "$temp_checkout"
  mv "$temp_checkout" "$CHECKOUT"
  temp_checkout=""
fi

step 3 'Adding the launcher'
cat >"$BIN_DIR/emailsender" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "${CHECKOUT}/scripts/start.sh" "\$@"
EOF
chmod +x "$BIN_DIR/emailsender"

add_path_line() {
  local profile="$1"
  local line='export PATH="$HOME/.local/bin:$PATH"'
  mkdir -p "$(dirname "$profile")"
  touch "$profile"
  if ! grep -Fqx "$line" "$profile"; then
    printf '\n# EmailSender command\n%s\n' "$line" >>"$profile"
  fi
}
add_fish_path_line() {
  local profile="$1"
  local line='fish_add_path $HOME/.local/bin'
  mkdir -p "$(dirname "$profile")"
  touch "$profile"
  if ! grep -Fqx "$line" "$profile"; then
    printf '\n# EmailSender command\n%s\n' "$line" >>"$profile"
  fi
}
case "${SHELL:-}" in
  */bash) add_path_line "$HOME/.bash_profile" ;;
  */zsh) add_path_line "$HOME/.zprofile" ;;
  */fish) add_fish_path_line "$HOME/.config/fish/config.fish" ;;
  *) add_path_line "$HOME/.profile" ;;
esac
export PATH="$BIN_DIR:$PATH"

step 4 'Preparing and opening the app'
echo "EmailSender is installed. Keep this terminal open while using the app."
trap - EXIT
"$BIN_DIR/emailsender" start
