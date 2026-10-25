#!/bin/zsh
set -u

RETRO_ROOT="${0:A:h}"
typeset -a RETRO_NODE_CANDIDATES
RETRO_NODE_CANDIDATES=(
  "${RETRO_LIBRARY_NODE:-}"
  "$(command -v node 2>/dev/null || true)"
  /opt/homebrew/bin/node
  # nvm versions newest first (n: by number, On: reversed), so an update is picked up at once.
  "$HOME"/.nvm/versions/node/v*/bin/node(NnOn)
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  /usr/local/bin/node
)
for RETRO_CANDIDATE in "${RETRO_NODE_CANDIDATES[@]}"; do
  [[ -n "$RETRO_CANDIDATE" && -x "$RETRO_CANDIDATE" ]] || continue
  RETRO_MAJOR="$("$RETRO_CANDIDATE" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || true)"
  if [[ "$RETRO_MAJOR" == <-> ]] && (( RETRO_MAJOR >= 22 )); then
    exec "$RETRO_CANDIDATE" "$RETRO_ROOT/scripts/library-control.mjs" "${1:-open}"
  fi
done
echo "ERROR Level Select needs Node.js 22 or newer."
exit 2
