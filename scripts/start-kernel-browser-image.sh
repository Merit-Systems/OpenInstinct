#!/usr/bin/env bash
set -euo pipefail

readonly KERNEL_IMAGES_COMMIT="57858c774681c646c238043d5cb75a9ff61797c6"
readonly IMAGE="local-vault-assistant/kernel-browser:${KERNEL_IMAGES_COMMIT:0:7}"
readonly CONTAINER_NAME="local-vault-assistant-browser"
readonly DATA_DIR="${LOCAL_VAULT_ASSISTANT_DATA_DIR:-$HOME/.local-vault-assistant}"
readonly RUNTIME_DIR="$DATA_DIR/browser-runtime"
readonly FLAGS_FILE="$RUNTIME_DIR/chromium-flags.json"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  exit 2
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  exit 2
fi

mkdir -p "$RUNTIME_DIR"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({flags:["--user-data-dir=/home/kernel/user-data","--disable-dev-shm-usage","--start-maximized","--remote-allow-origins=*","--enable-features=WebMCPTesting,DevToolsWebMCPSupport"]}))' "$FLAGS_FILE"

if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)" != "true" ]]; then
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker run --detach --rm \
    --name "$CONTAINER_NAME" \
    --platform linux/amd64 \
    --privileged \
    --tmpfs /dev/shm:size=2g \
    --memory 8192m \
    --publish 127.0.0.1:4277:10001 \
    --publish 127.0.0.1:4278:9222 \
    --env DISPLAY_NUM=1 \
    --env HEIGHT=900 \
    --env WIDTH=1440 \
    --env RUN_AS_ROOT=false \
    --env WITHDOCKER=1 \
    --mount "type=bind,src=$FLAGS_FILE,dst=/chromium/flags" \
    --volume local-vault-assistant-browser-profile:/home/kernel/user-data \
    "$IMAGE" >/dev/null
fi

for _ in {1..120}; do
  if curl --silent --fail http://127.0.0.1:4278/json/version >/dev/null 2>&1 && \
    curl --silent --fail http://127.0.0.1:4277/display >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done

printf 'The isolated Kernel browser image did not become ready.\n' >&2
exit 1
