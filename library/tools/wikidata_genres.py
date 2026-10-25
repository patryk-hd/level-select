#!/usr/bin/env python3
"""Fill in genres for games the Steam store can't classify.

Console-only and emulated titles never resolve against the Steam store, so
their genres come from Wikidata instead: each title is matched to a video-game
item, and its "genre" statements (P136) are read off it.

  ./tools/wikidata_genres.py --library      # every title in the Playnite CSV
  ./tools/wikidata_genres.py --missing-only # only titles Steam didn't resolve

This uses the Wikidata Action API rather than the SPARQL query service, which
is both faster per title and unaffected by query-service outages. Results are
cached in data/cache/wikidata-genres.jsonl and the run is resumable.
"""
import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import steam_meta

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "cache"
GENRE_CACHE = CACHE_DIR / "wikidata-genres.jsonl"
LABEL_CACHE = CACHE_DIR / "wikidata-labels.json"
LIBRARY_CSV = ROOT / "playnite_library.csv"
WISHLIST_JSON = ROOT / "steam-wishlist.json"

API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "playnite-library-site/1.0 (personal local tool)"
VIDEO_GAME_QID = "Q7889"


def api(params, timeout=30, attempts=5):
    """Every call goes through here so throttling is handled in one place:
    Wikidata answers 429 with a Retry-After when it wants you to slow down."""
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise
            wait = int(error.headers.get("Retry-After") or 0) or min(60, 5 * 2**attempt)
            print(f"  throttled ({error.code}), waiting {wait}s", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(min(30, 5 * 2**attempt))
    raise RuntimeError("unreachable")


def normalize(name):
    text = (name or "").lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[™®©]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


def title_variants(name):
    base = normalize(name)
    variants = {base}
    for suffix in steam_meta.EDITION_SUFFIXES:
        if base.endswith(" " + suffix):
            variants.add(base[: -len(suffix) - 1].strip())
    return {v for v in variants if v}


def claim_ids(entity, prop):
    ids = []
    for claim in (entity.get("claims") or {}).get(prop, []):
        value = (claim.get("mainsnak") or {}).get("datavalue", {}).get("value")
        if isinstance(value, dict) and value.get("id"):
            ids.append(value["id"])
    return ids


def looks_like_a_game(entity, description):
    if VIDEO_GAME_QID in claim_ids(entity, "P31"):
        return True
    return "video game" in (description or "").lower()


def resolve_title(name, delay):
    """Search Wikidata for the title and return the genre QIDs of the best
    video-game match, or None when nothing convincing turns up."""
    found = api(
        {
            "action": "wbsearchentities",
            "search": name,
            "language": "en",
            "uselang": "en",
            "type": "item",
            "limit": 7,
        }
    )
    candidates = found.get("search") or []
    if not candidates:
        return None

    time.sleep(delay)
    entities = api(
        {
            "action": "wbgetentities",
            "ids": "|".join(c["id"] for c in candidates),
            "props": "claims|descriptions",
            "languages": "en",
        }
    ).get("entities", {})

    variants = title_variants(name)
    scored = []
    for candidate in candidates:
        entity = entities.get(candidate["id"])
        if not entity:
            continue
        description = (entity.get("descriptions", {}).get("en") or {}).get("value", "")
        if not looks_like_a_game(entity, description):
            continue
        label = normalize(candidate.get("label"))
        if label in variants:
            rank = 0
        elif any(label.startswith(variant + " ") for variant in variants if len(variant) > 6):
            rank = 1  # same game with an edition/subtitle suffix
        else:
            continue
        scored.append((rank, candidate["id"], claim_ids(entity, "P136")))

    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], not item[2]))
    _, qid, genres = scored[0]
    return {"qid": qid, "genreIds": genres}


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


def load_labels():
    if LABEL_CACHE.exists():
        return json.loads(LABEL_CACHE.read_text(encoding="utf-8"))
    return {}


def resolve_labels(genre_ids, labels, delay):
    """Genre items are a small shared set, so their labels are cached once."""
    missing = sorted({gid for gid in genre_ids if gid not in labels})
    for start in range(0, len(missing), 50):
        chunk = missing[start : start + 50]
        entities = api(
            {"action": "wbgetentities", "ids": "|".join(chunk), "props": "labels", "languages": "en"}
        ).get("entities", {})
        for qid, entity in entities.items():
            labels[qid] = (entity.get("labels", {}).get("en") or {}).get("value", "")
        time.sleep(delay)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    LABEL_CACHE.write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
    return labels


def library_titles():
    titles = []
    seen = set()
    with LIBRARY_CSV.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            name = (row.get("Name") or "").strip()
            if name and name not in seen:
                seen.add(name)
                titles.append(name)
    return titles


def wishlist_titles():
    data = json.loads(WISHLIST_JSON.read_text(encoding="utf-8")).get("data", [])
    return [g.get("title", "").strip() for g in data if g.get("title")]


def steam_classified_titles():
    """Titles that already have genres from Steam don't need a second source."""
    name_map = steam_meta.load_name_map()
    details = steam_meta.load_details_cache()
    classified = set()
    for name, appid in name_map.items():
        payload = details.get(appid)
        if payload and steam_meta.clean_genres(steam_meta.genre_names(payload)):
            classified.add(name)
    return classified


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--library", action="store_true", help="Look up every Playnite library title.")
    parser.add_argument("--wishlist", action="store_true", help="Look up wishlist titles too.")
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Skip titles that already have genres from the Steam cache.",
    )
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between API calls (default 0.5).")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N titles (0 = no limit).")
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

    cache = load_cache()
    skip = steam_classified_titles() if args.missing_only else set()
    pending = [name for name in dict.fromkeys(titles) if name not in cache and name not in skip]
    print(f"{len(titles)} titles, {len(cache)} cached, {len(skip)} already classified by Steam, {len(pending)} to look up.")
    if args.limit:
        pending = pending[: args.limit]

    failures = 0
    for index, name in enumerate(pending, 1):
        try:
            result = resolve_title(name, args.delay)
            failures = 0
        except Exception as error:
            print(f"[{index}/{len(pending)}] {name!r}: {error}", flush=True)
            failures += 1
            if failures >= 10:
                print("Too many consecutive failures, stopping.")
                break
            time.sleep(args.delay)
            continue

        append_cache({"name": name, **(result or {"qid": None, "genreIds": []})})
        cache[name] = result or {}
        if index % 50 == 0 or index == len(pending):
            print(f"[{index}/{len(pending)}] {name} -> {(result or {}).get('qid')}", flush=True)
        time.sleep(args.delay)

    all_ids = {gid for record in load_cache().values() for gid in (record.get("genreIds") or [])}
    labels = resolve_labels(all_ids, load_labels(), args.delay)
    matched = sum(1 for record in load_cache().values() if record.get("genreIds"))
    print(f"Done. {matched} titles have Wikidata genres; {len(labels)} genre labels cached.")


if __name__ == "__main__":
    raise SystemExit(main())
