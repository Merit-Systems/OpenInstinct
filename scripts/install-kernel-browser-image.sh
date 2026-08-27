#!/usr/bin/env bash
set -euo pipefail

readonly KERNEL_IMAGES_COMMIT="57858c774681c646c238043d5cb75a9ff61797c6"
readonly IMAGE="local-vault-assistant/kernel-browser:${KERNEL_IMAGES_COMMIT:0:7}"
readonly DATA_DIR="${LOCAL_VAULT_ASSISTANT_DATA_DIR:-$HOME/.local-vault-assistant}"
readonly SOURCE_DIR="$DATA_DIR/kernel-images/$KERNEL_IMAGES_COMMIT"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop must be installed and running to install the isolated browser.\n' >&2
  exit 1
fi

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf 'Kernel browser image is already installed: %s\n' "$IMAGE"
  exit 0
fi

mkdir -p "$(dirname "$SOURCE_DIR")"
if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  git clone --filter=blob:none https://github.com/onkernel/kernel-images.git "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch origin "$KERNEL_IMAGES_COMMIT"
git -C "$SOURCE_DIR" checkout --detach "$KERNEL_IMAGES_COMMIT"

printf 'Building Kernel browser image. This one-time build can take several minutes.\n'
IMAGE="$IMAGE" "$SOURCE_DIR/images/chromium-headful/build-docker.sh"
printf 'Installed isolated browser image: %s\n' "$IMAGE"
