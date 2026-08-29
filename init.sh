#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir"

usage() {
  cat <<'EOF'
Usage: ./init.sh [--check] [--setup-only] [--skip-install]

Bootstrap local OpenInstinct development without overwriting .env.local.

  --check        Verify prerequisites only; do not touch files or services.
  --setup-only   Prepare the environment and dependencies, then stop.
  --skip-install Skip pnpm install --frozen-lockfile.
  --help         Show this help.
EOF
}

check_only=false
setup_only=false
skip_install=false

for argument in "$@"; do
  case "$argument" in
    --check) check_only=true ;;
    --setup-only) setup_only=true ;;
    --skip-install) skip_install=true ;;
    --help|-h) usage; exit 0 ;;
    *)
      printf 'Unknown option: %s\n\n' "$argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing prerequisite: %s\n' "$command_name" >&2
    return 1
  fi
}

check_prerequisites() {
  local node_version node_major
  require_command node
  require_command pnpm
  require_command docker

  node_version="$(node --version)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ "$node_major" != "24" ]]; then
    printf 'Node 24 is required; found %s.\n' "$node_version" >&2
    return 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    printf 'Docker Compose v2 is required (docker compose).\n' >&2
    return 1
  fi

  if ! docker info >/dev/null 2>&1; then
    printf 'Docker daemon is unavailable; start Docker, then try again.\n' >&2
    return 1
  fi
}

check_prerequisites

if [[ "$check_only" == true ]]; then
  printf 'Prerequisites are available.\n'
  exit 0
fi

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  chmod 600 .env.local
  cat <<'EOF' >&2
Created .env.local from .env.example with mode 0600.
Set KERNEL_API_KEY in .env.local, then run ./init.sh again.
Local phone auth uses the development-only code 000000; it does not perform a real Linq round trip.
EOF
  exit 1
fi

chmod 600 .env.local

has_kernel_api_key() {
  local line trimmed value
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    if [[ "$trimmed" =~ ^KERNEL_API_KEY[[:space:]]*=(.*)$ ]]; then
      value="${BASH_REMATCH[1]}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      [[ -n "$value" ]] && return 0
    fi
  done < .env.local
  return 1
}

if ! has_kernel_api_key; then
  printf 'KERNEL_API_KEY is missing or empty in .env.local. Set it, then run ./init.sh again.\n' >&2
  exit 1
fi

if [[ "$skip_install" == false ]]; then
  pnpm install --frozen-lockfile
fi

printf 'Local environment is ready. Local phone auth uses the development-only code 000000; it does not perform a real Linq round trip.\n'

if [[ "$setup_only" == true ]]; then
  exit 0
fi

exec pnpm dev
