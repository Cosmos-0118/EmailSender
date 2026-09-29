#!/usr/bin/env bash
set -euo pipefail

APP_NAME="EmailSender"
DEFAULT_REPO_URL="https://github.com/OWNER/REPOSITORY.git"
REPO_URL="${EMAILSENDER_REPO_URL:-}"
if [[ -z "$REPO_URL" || "$REPO_URL" == "$DEFAULT_REPO_URL" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Public EmailSender Git URL: " REPO_URL
  fi
fi
if [[ -z "$REPO_URL" || "$REPO_URL" == "$DEFAULT_REPO_URL" ]]; then
  echo "Set EMAILSENDER_REPO_URL to the public repository URL (or enter it when prompted)." >&2
  exit 2
fi

bootstrap() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then return; fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  if command -v "$tool" >/dev/null 2>&1; then return; fi
  if ! command -v brew >/dev/null 2>&1; then
    if [[ ! -t 0 ]]; then
      echo "Homebrew is missing and needs an interactive terminal to request the macOS administrator password. Run this installer from Terminal." >&2
      exit 1
    fi
    echo "Homebrew is missing. Its official installer may request your macOS administrator password to install command line tools."
    installer="$(mktemp)"
    trap 'rm -f "$installer"' EXIT
    curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
    /bin/bash "$installer"
    rm -f "$installer"
    trap - EXIT
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
}

bootstrap git
bootstrap node

DATA_ROOT="${HOME}/Library/Application Support/${APP_NAME}"
BIN_DIR="${HOME}/.local/bin"
CHECKOUT="${DATA_ROOT}/app"
mkdir -p "$DATA_ROOT" "$BIN_DIR"
if [[ -d "$CHECKOUT/.git" ]]; then
  git -C "$CHECKOUT" remote set-url origin "$REPO_URL"
else
  if [[ -e "$CHECKOUT" ]]; then
    echo "Refusing to replace an existing non-Git directory: $CHECKOUT" >&2
    exit 1
  fi
  git clone "$REPO_URL" "$CHECKOUT"
fi

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
case "${SHELL##*/}" in
  bash) add_path_line "$HOME/.bash_profile" ;;
  zsh) add_path_line "$HOME/.zprofile" ;;
  fish) add_fish_path_line "$HOME/.config/fish/config.fish" ;;
  *) add_path_line "$HOME/.profile" ;;
esac
export PATH="$BIN_DIR:$PATH"

echo "Installed EmailSender. ${BIN_DIR} is on PATH for this session; open a new terminal to use it from your shell profile."
"$BIN_DIR/emailsender" start
