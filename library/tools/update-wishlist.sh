#!/usr/bin/env bash
# Refresh the Steam metadata cache for the wishlist, then rebuild
# data/wishlist-data.js.
#
# Usage:
#   ./tools/update-wishlist.sh                       (fetch missing apps, rebuild)
#   ./tools/update-wishlist.sh --skip-fetch          (rebuild from the cache only)
#
# The fetch is rate-limited to stay inside Steam's ~200-requests-per-5-minutes
# budget, so a first run over a large wishlist takes a while. It is resumable:
# stop it with Ctrl-C and run it again later to pick up where it left off.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ "${1:-}" != "--skip-fetch" ]]; then
  python3 steam_enrich.py --wishlist "$@"
fi

python3 build_wishlist.py
