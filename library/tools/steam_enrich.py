#!/usr/bin/env python3
"""Fetch genre/category metadata from the Steam store for wishlist and library games.

Neither the Playnite CSV export nor the Steam wishlist dump carries genre
information, so it is pulled from Steam's public store API and cached on disk.
The cache is a JSONL file appended one app at a time, which makes the fetch
resumable: re-running only asks Steam about apps that are still missing.

  ./tools/steam_enrich.py --wishlist          # appids straight from the wishlist
  ./tools/steam_enrich.py --library           # library titles matched by name
  ./tools/steam_enrich.py --wishlist --library

Steam rate-limits this endpoint to roughly 200 requests per 5 minutes, so the
default delay is deliberately slow and the tool backs off on HTTP 429.
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

import steam_meta as meta

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "cache"
DETAILS_CACHE = CACHE_DIR / "steam-appdetails.jsonl"
NAME_MAP_CACHE = CACHE_DIR / "steam-name-map.jsonl"
WISHLIST_JSON = ROOT / "steam-wishlist.json"
LIBRARY_CSV = ROOT / "playnite_library.csv"

APPDETAILS_URL = "https://store.steampowered.com/api/appdetails"
STORESEARCH_URL = "https://store.steampowered.com/api/storesearch/"
USER_AGENT = "playnite-library-site/1.0 (local personal tool)"

# Fields worth keeping; the raw payload per app is ~40x larger than this.
KEEP = (
    "name",
    "type",
    "genres",
    "categories",
    "metacritic",
    "header_image",
    "release_date",
    "developers",
    "publishers",
    "short_description",
    "price_overview",
    "is_free",
    "recommendations",
    "platforms",
    "controller_support",
)


def fetch_json(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def load_cache():
    """Returns {appid: record}. Later lines win, so a re-fetch overwrites."""
    cache = {}
    if not DETAILS_CACHE.exists():
        return cache
    with DETAILS_CACHE.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            cache[str(record.get("appid"))] = record
    return cache


def append_cache(record):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with DETAILS_CACHE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def slim(payload):
    return {key: payload[key] for key in KEEP if key in payload}


def fetch_app(appid, country, language):
    query = urllib.parse.urlencode({"appids": appid, "cc": country, "l": language})
    body = fetch_json(f"{APPDETAILS_URL}?{query}")
    entry = (body or {}).get(str(appid)) or {}
    if not entry.get("success"):
        return {"appid": str(appid), "ok": False, "data": {}}
    return {"appid": str(appid), "ok": True, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "data": slim(entry.get("data") or {})}


def wishlist_appids():
    data = json.loads(WISHLIST_JSON.read_text(encoding="utf-8")).get("data", [])
    ids = []
    for game in data:
        gameid = game.get("gameid") or []
        if len(gameid) == 2 and gameid[0] == "steam":
            match = re.search(r"(\d+)", gameid[1])
            if match:
                ids.append(match.group(1))
    return ids


# ---------------------------------------------------------------- name matching

EDITION_WORDS = {
    "edition",
    "remaster",
    "remastered",
    "definitive",
    "complete",
    "enhanced",
    "deluxe",
    "ultimate",
    "goty",
    "game",
    "of",
    "the",
    "year",
    "hd",
    "anniversary",
    "gamemaker",
    "classic",
    "redux",
    "director",
    "s",
    "cut",
}

STOPWORD_SUFFIXES = (
    "game of the year edition",
    "definitive edition",
    "complete edition",
    "enhanced edition",
    "deluxe edition",
    "ultimate edition",
    "remastered",
    "goty edition",
)


def normalize_title(name):
    text = (name or "").lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[™®©]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    text = re.sub(r"\s+", " ", text)
    return text


def title_variants(name):
    base = normalize_title(name)
    variants = {base}
    for suffix in STOPWORD_SUFFIXES:
        if base.endswith(" " + suffix):
            variants.add(base[: -len(suffix) - 1].strip())
    # "Game: The Subtitle" also gets tried as plain "Game".
    head = re.split(r"[:\-]", name or "", maxsplit=1)[0]
    if head and normalize_title(head) and len(normalize_title(head)) > 3:
        variants.add(normalize_title(head))
    return {v for v in variants if v}


def library_titles():
    import csv

    titles = []
    with LIBRARY_CSV.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            name = (row.get("Name") or "").strip()
            if name:
                titles.append(name)
    return dedupe(titles)


def dedupe(values):
    seen = set()
    return [v for v in values if not (v in seen or seen.add(v))]


def load_name_map():
    """{library title: appid or None}. None means "searched, not on Steam"."""
    mapping = {}
    if not NAME_MAP_CACHE.exists():
        return mapping
    with NAME_MAP_CACHE.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            mapping[record["name"]] = record.get("appid")
    return mapping


def append_name_map(name, appid):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with NAME_MAP_CACHE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"name": name, "appid": appid}, ensure_ascii=False) + "\n")


def search_appid(name, country, language):
    """Steam retired ISteamApps/GetAppList, so titles are resolved through the
    store search endpoint. Only accept a hit whose name matches the query once
    both are normalized (or is that query plus an edition suffix), otherwise the
    fuzzy search happily returns an unrelated game for anything obscure."""
    query = urllib.parse.urlencode({"term": name, "l": language, "cc": country})
    body = fetch_json(f"{STORESEARCH_URL}?{query}")
    variants = title_variants(name)
    items = (body or {}).get("items") or []
    for item in items:
        if item.get("type") not in (None, "app", "game"):
            continue
        candidate = normalize_title(item.get("name"))
        if candidate in variants:
            return str(item.get("id"))
    for item in items:
        candidate = normalize_title(item.get("name"))
        for variant in variants:
            if len(variant) <= 6 or not variant.startswith(candidate + " "):
                continue
            # Only tolerate the difference if it is an edition/re-release suffix,
            # so "Hades II" never collapses onto "Hades".
            leftover = set(variant[len(candidate) + 1 :].split())
            if leftover and leftover <= EDITION_WORDS:
                return str(item.get("id"))
    return None


def resolve_library_names(country, language, delay, limit=0):
    mapping = load_name_map()
    pending = [name for name in library_titles() if name not in mapping]
    print(f"{len(mapping)} titles already resolved, {len(pending)} to search.")
    if limit:
        pending = pending[:limit]
    index = 0
    while index < len(pending):
        name = pending[index]
        index += 1
        try:
            appid = search_appid(name, country, language)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                print(f"[{index}/{len(pending)}] rate limited, sleeping 60s", flush=True)
                time.sleep(60)
                index -= 1  # retry the same title rather than skipping it
                continue
            print(f"[{index}/{len(pending)}] search {name!r}: HTTP {error.code}", flush=True)
            time.sleep(delay)
            continue
        except Exception as error:
            print(f"[{index}/{len(pending)}] search {name!r}: {error}", flush=True)
            time.sleep(delay)
            continue
        append_name_map(name, appid)
        mapping[name] = appid
        if index % 50 == 0 or index == len(pending):
            print(f"[{index}/{len(pending)}] {name} -> {appid}", flush=True)
        time.sleep(delay)
    matched = sum(1 for v in mapping.values() if v)
    print(f"Matched {matched} of {len(mapping)} searched library titles to Steam appids.")
    return mapping


# ---------------------------------------------------------------------- driver


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--wishlist", action="store_true", help="Fetch metadata for wishlist appids.")
    parser.add_argument("--library", action="store_true", help="Fetch metadata for name-matched library titles.")
    parser.add_argument("--delay", type=float, default=1.6, help="Seconds between requests (default 1.6).")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Stop after N requests per phase, so --library --limit 50 searches 50 titles (0 = no limit).",
    )
    parser.add_argument("--country", default=meta.load_store()["country"], help="Store country for prices (default: library/data/store.json, else gb).")
    parser.add_argument("--language", default="english")
    parser.add_argument("--retry-failed", action="store_true", help="Re-request apps previously marked unavailable.")
    parser.add_argument("--refresh", action="store_true", help="Refresh cached app details and record fresh price observation dates.")
    parser.add_argument("--search-only", action="store_true", help="With --library, only resolve titles to appids.")
    parser.add_argument("--prices", action="store_true", help="Refresh only the prices of cached wishlist games, 100 apps a request.")
    return parser.parse_args()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def refresh_prices(appids, country, delay):
    """Steam answers price-only questions for many apps at once, so a whole wishlist takes a
    handful of requests. Each cached record gets the new price and a fresh observation date;
    everything else it holds stays."""
    cache = load_cache()
    known = [appid for appid in appids if cache.get(appid, {}).get("ok")]
    changed = 0
    for start in range(0, len(known), 100):
        batch = known[start:start + 100]
        query = urllib.parse.urlencode({"appids": ",".join(batch), "cc": country, "filters": "price_overview"})
        try:
            body = fetch_json(f"{APPDETAILS_URL}?{query}") or {}
        except Exception as error:  # a failed batch keeps the previous prices
            print(f"Price batch {start // 100 + 1}: {error}", flush=True)
            time.sleep(delay)
            continue
        for appid in batch:
            entry = body.get(appid) or {}
            if not entry.get("success"):
                continue
            # Free games answer with an empty list instead of a price.
            price = entry.get("data").get("price_overview") if isinstance(entry.get("data"), dict) else None
            record = cache[appid]
            data = {**record.get("data", {})}
            if price:
                if data.get("price_overview") != price:
                    changed += 1
                data["price_overview"] = price
            else:
                data.pop("price_overview", None)
            append_cache({**record, "fetchedAt": now_iso(), "data": data})
        time.sleep(delay)
    print(f"Prices refreshed for {len(known)} wishlist games; {changed} changed.")
    return 0


def main():
    args = parse_args()
    if args.prices:
        return refresh_prices(wishlist_appids(), args.country, args.delay)
    if not args.wishlist and not args.library:
        args.wishlist = True

    targets = []
    if args.wishlist:
        targets.extend(wishlist_appids())
    if args.library:
        mapping = resolve_library_names(args.country, args.language, args.delay, args.limit)
        if args.search_only:
            return 0
        targets.extend(appid for appid in mapping.values() if appid)

    seen = set()
    ordered = [a for a in targets if not (a in seen or seen.add(a))]

    cache = load_cache()
    pending = [
        appid
        for appid in ordered
        if args.refresh or appid not in cache or (args.retry_failed and not cache[appid].get("ok"))
    ]
    print(f"{len(ordered)} apps requested, {len(ordered) - len(pending)} already cached, {len(pending)} to fetch.")
    if args.limit:
        pending = pending[: args.limit]

    failures = 0
    index = 0
    while index < len(pending):
        appid = pending[index]
        index += 1
        try:
            record = fetch_app(appid, args.country, args.language)
            failures = 0
        except urllib.error.HTTPError as error:
            if error.code == 429:
                print(f"[{index}/{len(pending)}] rate limited, sleeping 60s", flush=True)
                time.sleep(60)
                index -= 1  # retry the same app rather than skipping it
                continue
            print(f"[{index}/{len(pending)}] app {appid}: HTTP {error.code}", flush=True)
            failures += 1
            if failures >= 10:
                print("Too many consecutive failures, stopping.", file=sys.stderr)
                return 1
            time.sleep(args.delay)
            continue
        except Exception as error:  # network hiccups shouldn't lose earlier work
            print(f"[{index}/{len(pending)}] app {appid}: {error}", flush=True)
            failures += 1
            if failures >= 10:
                print("Too many consecutive failures, stopping.", file=sys.stderr)
                return 1
            time.sleep(args.delay)
            continue

        append_cache(record)
        if index % 25 == 0 or index == len(pending):
            print(f"[{index}/{len(pending)}] cached {record['appid']} {record['data'].get('name', '(unavailable)')}", flush=True)
        time.sleep(args.delay)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
