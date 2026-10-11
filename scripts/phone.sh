#!/usr/bin/env bash
# Runs the API and the app so you can use CleanPursuit on a phone in Expo Go,
# even when your computer and phone are not on the same Wi-Fi (for example on a hotspot).
#
#   ./scripts/phone.sh
#
# It starts the API, puts it behind an ngrok tunnel, then starts Expo with its own tunnel
# and points the app at the API tunnel. Scan the QR code with your phone's camera.
# Press Ctrl+C to stop everything. While it runs, anyone with the tunnel URL can reach the API.
#
# Needs: infisical (logged in), ngrok (with an authtoken), and npm install in app/ and server/.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}"
LOGS="${TMP%/}/cleanpursuit-phone"
API_PORT=3000

# Background jobs get their own process group, so stopping one also stops its children.
set -m

API_PID=""
NGROK_PID=""

stop() {
  trap - EXIT
  echo
  echo "Stopping the API and the API tunnel."
  for pid in "$NGROK_PID" "$API_PID"; do
    [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null || true
  done
}
trap stop EXIT
trap 'exit 130' INT TERM

fail() {
  echo "Error: $*" >&2
  exit 1
}

wait_for() {
  local seconds=$1 description=$2
  shift 2
  for _ in $(seq "$seconds"); do
    "$@" && return 0
    sleep 1
  done
  fail "$description did not start within $seconds seconds"
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

api_healthy() {
  curl -sf "http://localhost:$API_PORT/health" 2>/dev/null | grep -q '"status":"ok"'
}

command -v infisical >/dev/null || fail "install the Infisical CLI and run infisical login"
command -v ngrok >/dev/null || fail "install ngrok (brew install ngrok) and run ngrok config add-authtoken <token>"
[ -d "$ROOT/server/node_modules" ] || fail "run npm install in server/ first"
[ -d "$ROOT/app/node_modules" ] || fail "run npm install in app/ first"
mkdir -p "$LOGS"

# Reuse an API that is already running; otherwise start one on the first free port from 3000.
if port_in_use "$API_PORT" && api_healthy; then
  echo "The API is already running on port $API_PORT; using it."
else
  while port_in_use "$API_PORT"; do API_PORT=$((API_PORT + 1)); done
  echo "Starting the API on port $API_PORT (log: $LOGS/api.log)."
  (cd "$ROOT/server" && exec infisical run -- env PORT="$API_PORT" npm run dev) >"$LOGS/api.log" 2>&1 &
  API_PID=$!
  wait_for 60 "The API (see $LOGS/api.log)" api_healthy
fi

echo "Opening a tunnel to the API (log: $LOGS/ngrok.log)."
ngrok http "$API_PORT" --log stdout --log-format logfmt >"$LOGS/ngrok.log" 2>&1 &
NGROK_PID=$!
ngrok_url() {
  grep -o 'url=https://[^ ]*' "$LOGS/ngrok.log" | head -1 | cut -d= -f2
}
ngrok_ready() {
  grep -q 'ERR_NGROK' "$LOGS/ngrok.log" && fail "ngrok refused to start: $(grep -o 'ERR_NGROK_[0-9]*' "$LOGS/ngrok.log" | head -1); see $LOGS/ngrok.log"
  [ -n "$(ngrok_url)" ]
}
wait_for 30 "The ngrok tunnel (see $LOGS/ngrok.log)" ngrok_ready
API_URL="$(ngrok_url)"
curl -sf "$API_URL/health" >/dev/null || fail "the API is not reachable through $API_URL"
echo "The API is at $API_URL"
echo

# A variable set here wins over any app/.env.local, so that file is left alone.
# --clear rebuilds the bundle, because the API URL is baked into it.
# --go makes the QR code open Expo Go rather than a development build.
cd "$ROOT/app"
EXPO_PUBLIC_API_URL="$API_URL" npx expo start --tunnel --go --clear || true
