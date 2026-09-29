#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
if [[ "$ACTION" != "start" ]]; then
  echo "Usage: emailsender start" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${EMAILSENDER_DATA_DIR:-${HOME}/Library/Application Support/EmailSender/data}"
mkdir -p "$DATA_DIR"
export EMAILSENDER_DATA_DIR="$DATA_DIR"

if [[ ! -d "$CHECKOUT/.git" ]]; then
  echo "Managed checkout is missing Git metadata: $CHECKOUT" >&2
  exit 1
fi

cd "$CHECKOUT"
printf '\n[1/3] Checking for updates...\n'
git fetch --prune origin
git remote set-head origin -a >/dev/null 2>&1 || true
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
DEFAULT_BRANCH="${DEFAULT_BRANCH#origin/}"
if [[ -z "$DEFAULT_BRANCH" ]]; then
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/${candidate}"; then
      DEFAULT_BRANCH="$candidate"
      break
    fi
  done
fi
if [[ -z "$DEFAULT_BRANCH" ]]; then
  echo "Could not determine the repository's default branch." >&2
  exit 1
fi

# This checkout is managed application code. All user records live in DATA_DIR.
git reset --hard HEAD
git clean -fd
git checkout -B "$DEFAULT_BRANCH" "origin/${DEFAULT_BRANCH}"
git reset --hard "origin/${DEFAULT_BRANCH}"
git clean -fd

printf '\n[2/3] Preparing the app...\n'
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

LAUNCH_FILE="$DATA_DIR/launch.json"
rm -f "$LAUNCH_FILE"
printf '\n[3/3] Starting EmailSender...\n'
node server/index.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
URL=""
for attempt in {1..40}; do
  if [[ -s "$LAUNCH_FILE" ]]; then
    URL="$(node -e 'const url=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).url; if (typeof url !== "string" || !url) process.exit(1); process.stdout.write(url)' "$LAUNCH_FILE" 2>/dev/null)" || URL=""
    if [[ -n "$URL" ]]; then break; fi
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit 1
  fi
  sleep 0.25
done
if [[ -z "$URL" ]]; then
  echo "The local service did not become ready." >&2
  exit 1
fi
if [[ -z "${EMAILSENDER_NO_OPEN:-}" ]]; then
  if ! open "$URL" >/dev/null 2>&1; then
    printf 'Could not open the browser automatically. Open this private link: %s\n' "$URL"
  fi
else
  printf 'Open this private link: %s\n' "$URL"
fi
printf 'EmailSender is ready. Keep this terminal open while using it.\n'
wait "$SERVER_PID"
