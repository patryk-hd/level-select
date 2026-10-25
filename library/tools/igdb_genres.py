#!/usr/bin/env python3
"""Fetch genres from IGDB for every game in the library (and the wishlist).

IGDB covers console and emulated titles that have no Steam store page, and it
allows 4 requests/second, so a 2,400-game library resolves in about ten
minutes rather than the hours a Steam-based pass would take.

Credentials come from the environment and are never written into the project
folder:

    export IGDB_CLIENT_ID=your_client_id
    export IGDB_CLIENT_SECRET=your_client_secret
    ./tools/igdb_genres.py --library

Get them by creating a free application at https://dev.twitch.tv/console/apps
(OAuth Redirect URL can be http://localhost, Category "Application Integration").
The access token derived from them is cached under ~/.cache, outside this
repository, because everything inside the project folder is served by the local
web server.

Results land in data/cache/igdb-genres.jsonl, one line per title, so re-running
only asks about titles that aren't cached yet.
"""
import argparse
import csv
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import steam_meta

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "cache"
GENRE_CACHE = CACHE_DIR / "igdb-genres.jsonl"
TOKEN_CACHE = Path.home() / ".cache" / "playnite-library-site" / "igdb-token.json"
LIBRARY_CSV = ROOT / "playnite_library.csv"
WISHLIST_JSON = ROOT / "steam-wishlist.json"

TOKEN_URL = "https://id.twitch.tv/oauth2/token"
GAMES_URL = "https://api.igdb.com/v4/games"
USER_AGENT = "playnite-library-site/1.0 (personal local tool)"

# IGDB allows 4 requests/second; this stays comfortably under it.
REQUEST_DELAY = 0.3
BATCH_SIZE = 180


class CredentialsMissing(RuntimeError):
    pass


def get_token():
    """Client-credentials token, cached until shortly before it expires."""
    if TOKEN_CACHE.exists():
        try:
            cached = json.loads(TOKEN_CACHE.read_text(encoding="utf-8"))
            if cached.get("expires_at", 0) > time.time() + 300 and cached.get("access_token"):
                return cached["access_token"], cached["client_id"]
        except (json.JSONDecodeError, OSError):
            pass

    client_id = os.environ.get("IGDB_CLIENT_ID", "").strip()
    client_secret = os.environ.get("IGDB_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise CredentialsMissing(
            "Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in your environment.\n"
            "Create a free app at https://dev.twitch.tv/console/apps to get them, then:\n"
            "  export IGDB_CLIENT_ID=...\n"
            "  export IGDB_CLIENT_SECRET=...\n"
            "  ./tools/igdb_genres.py --library"
        )

    body = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret, "grant_type": "client_credentials"}
    ).encode()
    request = urllib.request.Request(TOKEN_URL, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_CACHE.write_text(
        json.dumps(
            {
                "access_token": payload["access_token"],
                "client_id": client_id,
                "expires_at": time.time() + int(payload.get("expires_in", 3600)),
            }
        ),
        encoding="utf-8",
    )
    TOKEN_CACHE.chmod(0o600)
    return payload["access_token"], client_id


def query(body, token, client_id, attempts=5):
    request = urllib.request.Request(
        GAMES_URL,
        data=body.encode("utf-8"),
        headers={
            "Client-ID": client_id,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                detail = error.read().decode("utf-8", errors="replace")[:300]
                raise RuntimeError(f"IGDB HTTP {error.code}: {detail}") from error
            time.sleep(min(30, 2 ** attempt))
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(min(30, 2 ** attempt))
    return []


def normalize(name):
    text = (name or "").lower()
    text = text.replace("&", " and ")
    # Apostrophes are dropped rather than turned into spaces, so a Playnite
    # entry like "Assassins Creed Syndicate" still matches IGDB's
    # "Assassin's Creed Syndicate".
    text = re.sub(r"[™®©'’ʼ]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


# Suffixes worth trying without, beyond the shared edition list: IGDB stores
# most re-releases under the plain title.
EXTRA_SUFFIXES = (
    "goty",
    "game of the year",
    "gold edition",
    "hd",
    "hd remaster",
    "anniversary edition",
    "classic",
    "collection",
)


def raw_variants(name):
    """Original-cased spellings to try against IGDB's case-insensitive `name ~`
    lookup, which needs the real punctuation rather than a normalized key."""
    base = re.sub(r"[™®©]", "", name or "").strip()
    variants = [base]
    for suffix in tuple(steam_meta.EDITION_SUFFIXES) + EXTRA_SUFFIXES:
        stripped = re.sub(rf"[\s:,-]*\b{re.escape(suffix)}\b\s*$", "", base, flags=re.I).strip()
        if stripped and stripped != base and stripped not in variants:
            variants.append(stripped)
    return variants


def title_variants(name):
    variants = {normalize(v) for v in raw_variants(name)}
    return {v for v in variants if v}


def apicalypse_string(value):
    """IGDB string literals are double-quoted with backslash escapes."""
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def genres_of(game):
    names = [g.get("name") for g in (game.get("genres") or []) if g.get("name")]
    if names:
        return names
    # Some obscure entries carry only themes ("Horror", "Stealth", "Survival").
    return [t.get("name") for t in (game.get("themes") or []) if t.get("name")]


def index_results(games, index):
    """Map every name and alternative name a result answers to onto its genres.
    Lower IGDB ids are the older, canonical entries, so they win ties."""
    for game in games:
        names = [game.get("name", "")]
        names += [a.get("name", "") for a in (game.get("alternative_names") or [])]
        payload = {"id": game.get("id"), "name": game.get("name"), "genres": genres_of(game)}
        for name in names:
            key = normalize(name)
            if not key:
                continue
            existing = index.get(key)
            if existing is None or (not existing["genres"] and payload["genres"]):
                index[key] = payload
            elif payload["genres"] and payload["id"] < existing["id"]:
                index[key] = payload


def fetch_by_name(titles, token, client_id, index):
    """Exact-name lookups, hundreds of titles per request.

    Off by default (--batch opts in): IGDB's case-insensitive `~` operator
    takes a single string rather than a list, and its case-sensitive `=` would
    only match titles whose capitalization already agrees with IGDB's, so the
    per-title search pass below is both more reliable and accurate enough.
    """
    keys = sorted({variant for title in titles for variant in title_variants(title)})
    batches = (len(keys) - 1) // BATCH_SIZE + 1
    for start in range(0, len(keys), BATCH_SIZE):
        chunk = keys[start : start + BATCH_SIZE]
        values = ",".join(apicalypse_string(key) for key in chunk)
        body = (
            "fields name,genres.name,themes.name,alternative_names.name;"
            f" where name ~ ({values}) | alternative_names.name ~ ({values});"
            " limit 500;"
        )
        index_results(query(body, token, client_id), index)
        print(f"  name batch {start // BATCH_SIZE + 1}/{batches}: index holds {len(index)}", flush=True)
        time.sleep(REQUEST_DELAY)
    return index


FIELDS = "fields name,genres.name,themes.name,alternative_names.name;"


def best_candidate(results, variants):
    """Rank matches so an exact title that actually carries genres beats a
    bundle or re-release that merely starts with the same words — otherwise
    "DREDGE" resolves to the genreless "Dredge+" that IGDB ranks first."""
    scored = []
    for game in results:
        names = [game.get("name", "")] + [a.get("name", "") for a in (game.get("alternative_names") or [])]
        genres = genres_of(game)
        for candidate in names:
            key = normalize(candidate)
            if not key:
                continue
            if key in variants:
                rank = 0
            elif any(key.startswith(v + " ") for v in variants if len(v) > 6):
                rank = 2
            else:
                continue
            # Within the same rank, prefer an entry that has genres at all,
            # then the lowest id (the original release rather than a bundle).
            scored.append((rank + (0 if genres else 1), game.get("id") or 0, game, genres))
            break
    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1]))
    _, _, game, genres = scored[0]
    return {"id": game.get("id"), "name": game.get("name"), "genres": genres}


def fetch_one(title, token, client_id):
    """Resolve a single title, cheapest and most precise lookup first.

    `name ~ "..."` is an exact, case-insensitive lookup that sidesteps IGDB's
    fuzzy ranking — which buries short titles like "A Way Out" below unrelated
    results — so it is tried for every spelling before falling back to search.
    """
    variants = title_variants(title)
    spellings = raw_variants(title)

    for spelling in spellings:
        body = f"{FIELDS} where name ~ {apicalypse_string(spelling)}; limit 20;"
        hit = best_candidate(query(body, token, client_id), variants)
        if hit:
            return hit
        time.sleep(REQUEST_DELAY)

    for spelling in spellings:
        body = f"search {apicalypse_string(spelling)}; {FIELDS} limit 15;"
        hit = best_candidate(query(body, token, client_id), variants)
        if hit:
            return hit
        time.sleep(REQUEST_DELAY)
    return None


def load_cache():
    cache = {}
    if not GENRE_CACHE.exists():
        return cache
    with GENRE_CACHE.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            cache[record["name"]] = record
    return cache


def append_cache(record):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with GENRE_CACHE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def library_titles():
    titles = []
    with LIBRARY_CSV.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            name = (row.get("Name") or "").strip()
            if name:
                titles.append(name)
    return list(dict.fromkeys(titles))


def wishlist_titles():
    data = json.loads(WISHLIST_JSON.read_text(encoding="utf-8")).get("data", [])
    return list(dict.fromkeys(g["title"].strip() for g in data if g.get("title")))


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--library", action="store_true", help="Look up Playnite library titles.")
    parser.add_argument("--wishlist", action="store_true", help="Look up Steam wishlist titles too.")
    parser.add_argument("--no-search", action="store_true", help="Skip the per-title search pass.")
    parser.add_argument("--batch", action="store_true", help="Try a batched exact-name pass first (see fetch_by_name).")
    parser.add_argument(
        "--retry-unmatched",
        action="store_true",
        help="Re-resolve cached titles that came back with no genres.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N titles (0 = no limit).")
    return parser.parse_args()


def main():
    args = parse_args()
    if not args.library and not args.wishlist:
        args.library = True

    titles = []
    if args.library:
        titles.extend(library_titles())
    if args.wishlist:
        titles.extend(wishlist_titles())
    titles = list(dict.fromkeys(titles))
    if args.limit:
        titles = titles[: args.limit]

    try:
        token, client_id = get_token()
    except CredentialsMissing as error:
        print(error)
        return 2

    cache = load_cache()
    if args.retry_unmatched:
        pending = [t for t in titles if t not in cache or not cache[t].get("genres")]
    else:
        pending = [title for title in titles if title not in cache]
    print(f"{len(titles)} titles, {len(cache)} cached, {len(pending)} to resolve.")
    if not pending:
        print("Nothing to do.")
        return 0

    index = {}
    if args.batch:
        print("Exact-name pass...")
        try:
            fetch_by_name(pending, token, client_id, index)
        except Exception as error:
            print(f"  batched lookup unavailable ({error}); falling back to per-title search.")
            index = {}

    matched = []
    unmatched = []
    for title in pending:
        hit = next((index[v] for v in title_variants(title) if v in index), None)
        (matched if hit else unmatched).append(title)
        if hit:
            append_cache({"name": title, "igdbId": hit["id"], "igdbName": hit["name"], "genres": hit["genres"]})
    if index:
        print(f"Exact-name pass matched {len(matched)}/{len(pending)}.")

    if unmatched and not args.no_search:
        print(f"Lookup pass for {len(unmatched)} titles...")
        for index_no, title in enumerate(unmatched, 1):
            try:
                hit = fetch_one(title, token, client_id)
            except Exception as error:
                print(f"  [{index_no}/{len(unmatched)}] {title!r}: {error}", flush=True)
                time.sleep(REQUEST_DELAY)
                continue
            append_cache(
                {
                    "name": title,
                    "igdbId": (hit or {}).get("id"),
                    "igdbName": (hit or {}).get("name"),
                    "genres": (hit or {}).get("genres", []),
                }
            )
            if index_no % 50 == 0 or index_no == len(unmatched):
                print(f"  [{index_no}/{len(unmatched)}] {title} -> {(hit or {}).get('igdbName') or (hit or {}).get('name')}", flush=True)
            time.sleep(REQUEST_DELAY)

    final = load_cache()
    with_genres = sum(1 for record in final.values() if record.get("genres"))
    print(f"Done. {with_genres}/{len(final)} cached titles have IGDB genres.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
