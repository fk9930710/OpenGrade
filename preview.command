#!/bin/zsh
cd "$(dirname "$0")"

if [[ -n "$1" ]]; then
  PORT="$1"
else
  PORT=""
  for CANDIDATE in {4180..4199}; do
    if ! lsof -nP -iTCP:"$CANDIDATE" -sTCP:LISTEN >/dev/null 2>&1; then
      PORT="$CANDIDATE"
      break
    fi
  done
fi

if [[ -z "$PORT" ]]; then
  echo "Could not find an available preview port."
  read "?Press Return to close."
  exit 1
fi

echo "Starting OpenGrade at http://127.0.0.1:${PORT}"
echo "Keep this window open. Press Control-C to stop."
npm run dev -- --port "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

READY=0
for ATTEMPT in {1..50}; do
  if curl --silent --fail "http://127.0.0.1:${PORT}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if [[ "$READY" -eq 1 ]]; then
  echo "OpenGrade is ready."
  open "http://127.0.0.1:${PORT}"
else
  echo "OpenGrade could not start. The browser was not opened."
fi

wait "$SERVER_PID"
