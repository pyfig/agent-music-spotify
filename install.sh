#!/usr/bin/env bash
set -euo pipefail

# amusic installer: ensures bun, fetches the repo when piped via curl,
# installs deps, links the `amusic` command.

REPO_URL="https://github.com/pyfig/agent-music-spotify.git"
BIN_DIR="${HOME}/.local/bin"
CLONE_DIR="${HOME}/.local/share/amusic"

echo "amusic installer"

# When run from a checkout, use it; when piped (curl | bash), clone/update.
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/package.json" ]]; then
  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  if [[ -d "${CLONE_DIR}/.git" ]]; then
    echo "updating ${CLONE_DIR}…"
    git -C "${CLONE_DIR}" fetch --tags origin
  else
    echo "cloning ${REPO_URL} → ${CLONE_DIR}…"
    git clone "${REPO_URL}" "${CLONE_DIR}"
  fi
  # Pin to the latest release tag; fall back to default branch tip if none.
  LATEST_TAG="$(git -C "${CLONE_DIR}" tag -l 'v*' --sort=-v:refname | head -1)"
  if [[ -n "${LATEST_TAG}" ]]; then
    echo "checking out ${LATEST_TAG}…"
    git -C "${CLONE_DIR}" checkout --quiet "${LATEST_TAG}"
  fi
  REPO_DIR="${CLONE_DIR}"
fi
echo "repo: ${REPO_DIR}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found — installing…"
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
fi
echo "bun: $(bun --version)"

echo "installing dependencies…"
(cd "${REPO_DIR}" && bun install)

mkdir -p "${BIN_DIR}"
cat > "${BIN_DIR}/amusic" <<EOF
#!/usr/bin/env bash
REPO_DIR="${REPO_DIR}"

# Auto-update to the latest GitHub release tag (v*), checked at most once
# per day. Only runs on managed clones (~/.local/share/amusic), never on a
# dev checkout, and never over local changes.
UPDATE_STAMP="\${REPO_DIR}/.update-checked"

check_and_update() {
  command -v git >/dev/null 2>&1 || return 0
  [ -d "\${REPO_DIR}/.git" ] || return 0
  case "\${REPO_DIR}" in
    "\${HOME}/.local/share/amusic") ;;
    *) return 0 ;;  # dev checkout — leave it alone
  esac
  cd "\${REPO_DIR}" 2>/dev/null || return 0

  # Throttle: skip if we checked within the last 24h.
  if [ -f "\${UPDATE_STAMP}" ] && [ -n "\$(find "\${UPDATE_STAMP}" -mmin -1440 2>/dev/null)" ]; then
    return 0
  fi

  if [ -n "\$(git status --porcelain 2>/dev/null)" ]; then
    echo "amusic: local changes detected, skipping update"
    return 0
  fi

  if ! git fetch --quiet --tags origin 2>/dev/null; then
    echo "amusic: fetch failed (offline?), running local version"
    return 0
  fi
  touch "\${UPDATE_STAMP}" 2>/dev/null

  local latest_tag tag_sha head_sha
  latest_tag="\$(git tag -l 'v*' --sort=-v:refname | head -1)"
  [ -n "\${latest_tag}" ] || return 0

  tag_sha="\$(git rev-parse "\${latest_tag}^{commit}" 2>/dev/null)"
  head_sha="\$(git rev-parse HEAD 2>/dev/null)"
  [ -n "\${tag_sha}" ] && [ -n "\${head_sha}" ] || return 0
  [ "\${tag_sha}" = "\${head_sha}" ] && return 0

  if git checkout --quiet "\${latest_tag}" 2>/dev/null; then
    echo "amusic: updated to \${latest_tag}"
    bun install --silent 2>/dev/null || echo "amusic: bun install failed, continuing"
  else
    echo "amusic: checkout of \${latest_tag} failed, running local version"
  fi
}

check_and_update
exec bun run "\${REPO_DIR}/src/index.tsx" "\$@"
EOF
chmod +x "${BIN_DIR}/amusic"
echo "installed: ${BIN_DIR}/amusic"

# Keep the old command name working for existing users.
ln -sf "${BIN_DIR}/amusic" "${BIN_DIR}/music-agent"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo ""
    echo "NOTE: ${BIN_DIR} is not in your PATH. Add it, e.g.:"
    echo "  fish:  fish_add_path ${BIN_DIR}"
    echo "  bash/zsh:  export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac

echo ""
echo "done. run: amusic"
