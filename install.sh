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
    git -C "${CLONE_DIR}" pull --ff-only
  else
    echo "cloning ${REPO_URL} → ${CLONE_DIR}…"
    git clone --depth 1 "${REPO_URL}" "${CLONE_DIR}"
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
exec bun run "${REPO_DIR}/src/index.tsx" "\$@"
EOF
chmod +x "${BIN_DIR}/amusic"
echo "installed: ${BIN_DIR}/amusic"

# Keep the old command name working for existing users.
ln -sf "${BIN_DIR}/amusic" "${BIN_DIR}/vibedeck"

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
