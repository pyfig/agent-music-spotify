#!/usr/bin/env bash
set -euo pipefail

# vibedeck installer: ensures bun, installs deps, links the `vibedeck` command.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

echo "vibedeck installer"
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
cat > "${BIN_DIR}/vibedeck" <<EOF
#!/usr/bin/env bash
exec bun run "${REPO_DIR}/src/index.tsx" "\$@"
EOF
chmod +x "${BIN_DIR}/vibedeck"
echo "installed: ${BIN_DIR}/vibedeck"

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
echo "done. run: vibedeck"
