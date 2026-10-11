#!/usr/bin/env bash
# Runs the API and the app so you can use CleanPursuit on a phone in Expo Go,
# even when your computer and phone are not on the same Wi-Fi (for example on a hotspot).
#
#   ./scripts/phone.sh
#
# It starts the API and Metro, puts each behind a Cloudflare quick tunnel, points the app at the
# API tunnel, and prints a QR code for Expo Go. Press Ctrl+C to stop everything.
# While it runs, anyone with a tunnel URL can reach the API or the app bundle.
#
# Expo's own `--tunnel` is not used: it runs an old bundled ngrok that often fails to connect.
# Cloudflare quick tunnels need no account and give each tunnel its own random URL.
#
# Needs: infisical (logged in), cloudflared (brew install cloudflared), and npm install in app/ and server/.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}"
LOGS="${TMP%/}/cleanpursuit-phone"
API_PORT=3000
METRO_PORT=8081

# Background jobs get their own process group, so stopping one also stops its children.
set -m

API_PID=""
API_TUNNEL_PID=""
METRO_TUNNEL_PID=""
EXPO_PGID=""

stop() {
  trap - EXIT
  echo
  echo "Stopping the app, the API and their tunnels."
  for pid in "$EXPO_PGID" "$METRO_TUNNEL_PID" "$API_TUNNEL_PID" "$API_PID"; do
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

# Tunnel URLs are looked up through Cloudflare's DNS over HTTPS. A brand-new tunnel name is not
# in DNS for its first few seconds, and asking the system resolver then caches the miss.
fetch() {
  case "$1" in
    https://*.trycloudflare.com/*) curl -sf --max-time 10 --doh-url https://cloudflare-dns.com/dns-query "$1" ;;
    *) curl -sf --max-time 10 "$1" ;;
  esac
}

api_healthy() {
  fetch "$1/health" 2>/dev/null | grep -q '"status":"ok"'
}

metro_running() {
  fetch "$1/status" 2>/dev/null | grep -q 'packager-status:running'
}

# Quick tunnel names look like four-random-words.trycloudflare.com.
tunnel_url() {
  grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$1" | head -1
}

tunnel_ready() {
  [ -n "$(tunnel_url "$1")" ]
}

command -v infisical >/dev/null || fail "install the Infisical CLI and run infisical login"
command -v cloudflared >/dev/null || fail "install cloudflared (brew install cloudflared)"
[ -d "$ROOT/server/node_modules" ] || fail "run npm install in server/ first"
[ -d "$ROOT/app/node_modules" ] || fail "run npm install in app/ first"
mkdir -p "$LOGS"

# Reuse an API that is already running; otherwise start one on the first free port from 3000.
if port_in_use "$API_PORT" && api_healthy "http://localhost:$API_PORT"; then
  echo "The API is already running on port $API_PORT; using it."
else
  while port_in_use "$API_PORT"; do API_PORT=$((API_PORT + 1)); done
  echo "Starting the API on port $API_PORT (log: $LOGS/api.log)."
  (cd "$ROOT/server" && exec infisical run -- env PORT="$API_PORT" npm run dev) >"$LOGS/api.log" 2>&1 &
  API_PID=$!
  wait_for 60 "The API (see $LOGS/api.log)" api_healthy "http://localhost:$API_PORT"
fi

while port_in_use "$METRO_PORT"; do METRO_PORT=$((METRO_PORT + 1)); done

echo "Opening tunnels to the API and Metro (logs: $LOGS/api-tunnel.log, $LOGS/metro-tunnel.log)."
cloudflared tunnel --no-autoupdate --url "http://localhost:$API_PORT" >"$LOGS/api-tunnel.log" 2>&1 &
API_TUNNEL_PID=$!
cloudflared tunnel --no-autoupdate --url "http://localhost:$METRO_PORT" >"$LOGS/metro-tunnel.log" 2>&1 &
METRO_TUNNEL_PID=$!
wait_for 30 "The API tunnel (see $LOGS/api-tunnel.log)" tunnel_ready "$LOGS/api-tunnel.log"
wait_for 30 "The Metro tunnel (see $LOGS/metro-tunnel.log)" tunnel_ready "$LOGS/metro-tunnel.log"
API_URL="$(tunnel_url "$LOGS/api-tunnel.log")"
METRO_URL="$(tunnel_url "$LOGS/metro-tunnel.log")"

echo "Waiting for the API to answer at $API_URL"
wait_for 60 "The API through $API_URL" api_healthy "$API_URL"
echo "The API is reachable."
echo

# EXPO_PUBLIC_API_URL set here wins over any app/.env.local, so that file is left alone.
# EXPO_PACKAGER_PROXY_URL makes the manifest point the phone at the Metro tunnel.
# --clear rebuilds the bundle, because the API URL is baked into it.
# Piping the output makes Expo non-interactive, so it skips its own QR code, whose exp:// link
# would make Expo Go use plain HTTP on the tunnel's HTTPS port. File watching stays on.
cd "$ROOT/app"
EXPO_PUBLIC_API_URL="$API_URL" EXPO_PACKAGER_PROXY_URL="$METRO_URL" \
  npx expo start --go --clear --port "$METRO_PORT" </dev/null 2>&1 | cat &
EXPO_PID=$!
EXPO_PGID=$(ps -o pgid= -p "$EXPO_PID" | tr -d ' ')

wait_for 120 "Metro" metro_running "http://localhost:$METRO_PORT"
echo "Waiting for Metro to answer at $METRO_URL"
wait_for 60 "Metro through $METRO_URL" metro_running "$METRO_URL"

# exps:// tells Expo Go to use HTTPS.
EXPO_GO_URL="exps://${METRO_URL#https://}"
echo
echo "Open the app in Expo Go: $EXPO_GO_URL"
echo "Scan this with your phone's camera. The first load builds the bundle and takes a minute."
node -e "require('expo/node_modules/@expo/cli/build/src/utils/qr.js').printQRCode(process.argv[1]).print()" \
  "$EXPO_GO_URL" 2>/dev/null || echo "(Could not draw a QR code; open the link above on your phone.)"
echo "To open a screen directly, add /--/<path>, for example $EXPO_GO_URL/--/resources"
echo "Press Ctrl+C to stop."

wait "$EXPO_PID"
