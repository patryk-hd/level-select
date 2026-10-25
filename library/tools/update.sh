#!/usr/bin/env bash
# Rebuild data/library-data.js from a Playnite CSV export.
# Usage:
#   ./tools/update.sh                                   (uses the default CSV/backup paths)
#   ./tools/update.sh --csv ~/Downloads/playnite_library.csv
#
# Genres come from the Steam metadata cache; run ./tools/update-wishlist.sh or
# tools/steam_enrich.py --library to fill or refresh it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
python3 build_site.py "$@"
node ../../scripts/connect-library.mjs
