#!/usr/bin/env bash
# Fetch genres from IGDB for the whole library, then rebuild both pages.
#
# Needs a free Twitch application (https://dev.twitch.tv/console/apps):
#   export IGDB_CLIENT_ID=your_client_id
#   export IGDB_CLIENT_SECRET=your_client_secret
#   ./tools/update-genres.sh
#
# Safe to re-run: only titles that aren't cached yet are requested, so a
# repeat run after adding games to Playnite costs only those new titles.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

python3 igdb_genres.py --library "$@"
python3 build_site.py --csv ../playnite_library.csv
python3 build_wishlist.py
