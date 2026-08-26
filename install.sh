#!/usr/bin/env bash
set -euo pipefail

readonly PRODUCT_NAME="Local Vault Assistant"
readonly REPOSITORY="Merit-Systems/open-instinct"
readonly NODE_VERSION="24.12.0"
readonly PNPM_VERSION="11.15.1"
readonly INSTALL_HOME="${LOCAL_VAULT_ASSISTANT_HOME:-$HOME/.local/share/local-vault-assistant}"
readonly APP_DIR="$INSTALL_HOME/app"
readonly RELEASES_DIR="$INSTALL_HOME/releases"
readonly BIN_DIR="${LOCAL_VAULT_ASSISTANT_BIN_DIR:-$HOME/.local/bin}"

temporary_directory=""
release_directory=""
release_ready=0

cleanup() {
  if [[ -n "$temporary_directory" && -d "$temporary_directory" ]]; then
    rm -rf "$temporary_directory"
  fi
  if [[ "$release_ready" != "1" && -n "$release_directory" && \
    -d "$release_directory" ]]; then
    rm -rf "$release_directory"
  fi
}

trap cleanup EXIT

info() {
  printf '\033[36m→\033[0m %s\n' "$1"
}

success() {
  printf '\033[32m✓\033[0m %s\n' "$1"
}

fail() {
  printf '\033[31m✗\033[0m %s\n' "$1" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "$PRODUCT_NAME currently requires macOS for its Keychain-backed vault."
fi

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."

case "$(uname -m)" in
  arm64) node_architecture="arm64" ;;
  x86_64) node_architecture="x64" ;;
  *) fail "Unsupported Mac architecture: $(uname -m)" ;;
esac

printf '\n\033[1m%s\033[0m\n\n' "$PRODUCT_NAME"
temporary_directory="$(mktemp -d)"
mkdir -p "$INSTALL_HOME" "$RELEASES_DIR" "$BIN_DIR"

node_major="0"
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
fi

if ((node_major == 24)); then
  node_bin_directory="$(dirname "$(command -v node)")"
  success "Using Node.js $(node --version)"
else
  node_distribution="node-v${NODE_VERSION}-darwin-${node_architecture}"
  node_archive="${node_distribution}.tar.gz"
  node_runtime="$INSTALL_HOME/runtime/node"
  info "Installing an isolated Node.js runtime"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}" \
    -o "$temporary_directory/$node_archive"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    -o "$temporary_directory/SHASUMS256.txt"
  awk -v archive="$node_archive" '$2 == archive { print }' \
    "$temporary_directory/SHASUMS256.txt" \
    >"$temporary_directory/expected-shasum"
  [[ -s "$temporary_directory/expected-shasum" ]] || fail "Node.js checksum was not published."
  (
    cd "$temporary_directory"
    shasum -a 256 -c expected-shasum >/dev/null
  )
  rm -rf "$node_runtime"
  mkdir -p "$node_runtime"
  tar -xzf "$temporary_directory/$node_archive" \
    -C "$node_runtime" --strip-components=1
  node_bin_directory="$node_runtime/bin"
  success "Installed Node.js v$NODE_VERSION"
fi

export PATH="$INSTALL_HOME/tools/bin:$node_bin_directory:$PATH"
command -v npm >/dev/null 2>&1 || fail "npm was not found beside Node.js."

if [[ ! -x "$INSTALL_HOME/tools/bin/pnpm" ]] || \
  [[ "$($INSTALL_HOME/tools/bin/pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
  info "Installing the package runtime"
  npm install --global --prefix "$INSTALL_HOME/tools" "pnpm@$PNPM_VERSION" \
    --no-audit --no-fund >/dev/null
fi
success "Package runtime ready"

source_archive="$temporary_directory/source.tar.gz"
archive_url="${LOCAL_VAULT_ASSISTANT_ARCHIVE_URL:-https://api.github.com/repos/$REPOSITORY/tarball/main}"
info "Downloading the latest release"
if ! curl -fsSL "$archive_url" -o "$source_archive" 2>/dev/null; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    info "Using authenticated GitHub access"
    gh api "repos/$REPOSITORY/tarball/main" >"$source_archive"
  else
    fail "The source could not be downloaded. If the repository is private, authenticate with GitHub CLI first."
  fi
fi

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_directory="$RELEASES_DIR/$release_id"
mkdir -p "$release_directory"
tar -xzf "$source_archive" -C "$release_directory" --strip-components=1

info "Installing dependencies"
(
  cd "$release_directory"
  "$INSTALL_HOME/tools/bin/pnpm" install --frozen-lockfile
)

info "Building the local agent"
(
  cd "$release_directory"
  "$INSTALL_HOME/tools/bin/pnpm" build:eve
  [[ -f .output/server/index.mjs ]] || fail "The local agent build was not created."
  touch .output/.local-vault-assistant-build
)

info "Building the local manager"
(
  cd "$release_directory"
  EVE_NEXT_PRODUCTION_ORIGIN="http://127.0.0.1:4274" \
    "$INSTALL_HOME/tools/bin/pnpm" build
  [[ -f .next/BUILD_ID ]] || fail "The local manager build was not created."
)

next_link="$INSTALL_HOME/app.next"
rm -f "$next_link"
ln -s "$release_directory" "$next_link"

if [[ -L "$APP_DIR" ]]; then
  rm "$APP_DIR"
elif [[ -e "$APP_DIR" ]]; then
  mv "$APP_DIR" "$INSTALL_HOME/app.previous.$release_id"
fi
mv "$next_link" "$APP_DIR"
release_ready=1

launcher="$BIN_DIR/local-vault-assistant"
{
  cat <<'LAUNCHER_HEADER'
#!/usr/bin/env bash
set -euo pipefail
LAUNCHER_HEADER
  printf 'install_home=%q\n' "$INSTALL_HOME"
  printf 'bin_directory=%q\n' "$BIN_DIR"
  cat <<'LAUNCHER_BODY'

export LOCAL_VAULT_ASSISTANT_HOME="$install_home"
export LOCAL_VAULT_ASSISTANT_BIN_DIR="$bin_directory"
export PATH="$install_home/tools/bin:$install_home/runtime/node/bin:$PATH"
exec "$install_home/app/bin/local-assistant" "$@"
LAUNCHER_BODY
} >"$launcher"
chmod +x "$launcher"

success "$PRODUCT_NAME is installed"
printf '\nStart it with:\n\n  %s\n\n' "$launcher"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  printf 'Optional: add %s to PATH to run `local-vault-assistant` anywhere.\n\n' "$BIN_DIR"
fi
