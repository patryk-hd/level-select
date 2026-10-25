#!/usr/bin/env python3
import argparse
import csv
import html
import json
import re
import shutil
import subprocess
import math
import hashlib
from collections import Counter
from pathlib import Path

import steam_meta
from title_groups import plan_groups, read_previous


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "playnite_library.csv"
DEFAULT_BACKUP_ROOT = ROOT / "playnite_library_backup"
DEFAULT_OUT = ROOT / "data" / "library-data.js"
DEFAULT_SOURCES = ROOT / "data" / "sources"
# Connected sources besides Playnite, in priority order: when two have the same game from
# the same store, the first one wins (Playnite before all of them).
# Installed Steam games come last: they only add games no other source has (Family Sharing).
SOURCE_FILES = ["galaxy.json", "steam-owned.json", "steam-installed.json"]
OVERRIDES_PATH = ROOT / "data" / "overrides.json"


def parse_args():
    parser = argparse.ArgumentParser(description="Build the Playnite library site data from a CSV export.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to the Playnite CSV export.")
    parser.add_argument(
        "--backup-root",
        type=Path,
        default=DEFAULT_BACKUP_ROOT,
        help="Path to the Playnite backup folder (contains libraryfiles/ and library/games.db).",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Where to write the generated data JS file.")
    parser.add_argument("--previous", type=Path, help="Previous generated library for stable groups and note lineage (defaults to --out).")
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES, help="Folder with games from connected sources (GOG Galaxy, Steam).")
    return parser.parse_args()


def split_list(value):
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]

def dedupe(values):
    seen = set()
    ordered = []
    for value in values:
        if value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered


def number(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        if "." in value:
            result = float(value)
            return result if math.isfinite(result) else None
        return int(value)
    except ValueError:
        return None


def clean_description(value, limit=360):
    if not value:
        return ""
    text = html.unescape(value)
    text = re.sub(r"<(br|/p|/h\d|/li)\b[^>]*>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "..."


def year_from_date(value):
    value = (value or "").strip()
    if not value:
        return None
    match = re.search(r"(19|20)\d{2}", value)
    if not match:
        return None
    return int(match.group(0))


def sortable_date(value):
    value = (value or "").strip()
    if not value:
        return ""
    parts = re.split(r"[/-]", value)
    if len(parts) >= 3:
        if len(parts[0]) == 4:
            y, m, d = parts[:3]
        else:
            m, d, y = parts[:3]
        try:
            return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        except ValueError:
            return ""
    return ""


def normalize_name(name):
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def title_key(name):
    """Titles compared across apps: "DOOM®" and "Doom" are the same game in one store."""
    return re.sub(r"[^a-z0-9]+", " ", re.sub(r"[™®©]", "", (name or "").lower())).strip()


def slugify(name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "untitled"


def file_url(path):
    return path.as_posix().replace(" ", "%20")


def existing_media_url(game_id, target_root, root):
    """Cover/background folders are named after the game's CSV Id, so
    previously-copied art can be found without needing games.db at all —
    this keeps CSV-only rebuilds working when the Playnite backup isn't mounted."""
    if not game_id:
        return ""
    folder = target_root / game_id
    if not folder.is_dir():
        return ""
    for file in sorted(folder.iterdir()):
        if file.is_file():
            return file_url(file.relative_to(root))
    return ""


def copy_media(ref, game_id, target_root, library_files, root):
    existing = existing_media_url(game_id, target_root, root)
    if existing:
        return existing
    if not ref:
        return ""
    relative = Path(ref.replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts:
        return ""
    source = library_files / relative
    if not source.exists():
        return ""
    target = target_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return file_url(target.relative_to(root))


def extract_media_refs(games_db):
    if not games_db.exists():
        return {}

    # `strings` comes with macOS and Linux; without it (Windows) the backup's media is skipped.
    try:
        output = subprocess.check_output(["strings", "-a", str(games_db)], text=True, errors="ignore")
    except (OSError, subprocess.CalledProcessError):
        return {}
    lines = output.splitlines()
    refs = {}
    pending = {}

    for index, line in enumerate(lines):
        if line == "EnableSystemHdr":
            pending = {}
        elif line in {"CoverImage", "BackgroundImage", "ReleaseDate"} and index + 1 < len(lines):
            pending[line] = lines[index + 1].strip()
            if line in {"CoverImage", "BackgroundImage"}:
                media_ref = pending[line]
                folder = media_ref.replace("\\", "/").split("/", 1)[0]
                if re.fullmatch(r"[0-9a-fA-F-]{36}", folder):
                    entry = refs.setdefault(folder, {"cover": "", "background": "", "backupReleaseDate": ""})
                    if line == "CoverImage":
                        entry["cover"] = media_ref
                    else:
                        entry["background"] = media_ref
                    if pending.get("ReleaseDate"):
                        entry["backupReleaseDate"] = pending["ReleaseDate"]
        elif line == "GameId" and index + 1 < len(lines):
            game_id = lines[index + 1].strip()
            if re.fullmatch(r"[0-9a-fA-F-]{36}", game_id):
                entry = {
                    "cover": pending.get("CoverImage", ""),
                    "background": pending.get("BackgroundImage", ""),
                    "backupReleaseDate": pending.get("ReleaseDate", ""),
                }
                refs[game_id] = entry
                for media_field in ("cover", "background"):
                    media_ref = entry.get(media_field, "")
                    folder = media_ref.replace("\\", "/").split("/", 1)[0]
                    if re.fullmatch(r"[0-9a-fA-F-]{36}", folder):
                        refs[folder] = entry
            pending = {}

    return refs


def load_overrides(path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        print(f"Warning: could not read overrides file {path}: {error}")
        return {}
    if not isinstance(data, dict):
        print(f"Warning: overrides file {path} must contain a JSON object, ignoring.")
        return {}
    return data


def read_rows(csv_path, media_refs, cover_root, bg_root, library_files, root):
    # Playnite's CSV export carries no genre column. IGDB is the primary source
    # because it covers console and emulated titles too; the Steam and Wikidata
    # caches are used as fallbacks when a title isn't in IGDB. All three are
    # normalized to the same main-category vocabulary in steam_meta.
    igdb = steam_meta.load_igdb_genres()
    name_map = steam_meta.load_name_map()
    details = steam_meta.load_details_cache()
    wikidata = steam_meta.load_wikidata_genres()

    rows = []
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"Id", "Name", "Platforms", "Sources"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Choose a Playnite CSV with Id, Name, Platforms and Sources columns. No snapshot was replaced.")
        seen_ids = set()
        for row in reader:
            game_id = row.get("Id", "").strip()
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", game_id) or game_id in seen_ids:
                raise ValueError("Every CSV copy needs a unique, non-empty Id. No snapshot was replaced.")
            if not (row.get("Name") or "").strip():
                raise ValueError("Every CSV copy needs a title. No snapshot was replaced.")
            seen_ids.add(game_id)
            media = media_refs.get(game_id, {})
            release_date = row.get("Release Date", "").strip() or media.get("backupReleaseDate", "")
            platforms = split_list(row.get("Platforms", ""))
            sources = split_list(row.get("Sources", ""))
            tags = split_list(row.get("Tags", ""))
            categories = split_list(row.get("Categories", ""))
            developers = split_list(row.get("Developers", ""))
            publishers = split_list(row.get("Publishers", ""))
            play_count = number(row.get("Play Count")) or 0
            time_played = number(row.get("Time Played")) or 0
            community_score = number(row.get("Community Score"))
            critic_score = number(row.get("Critic Score"))
            user_score = number(row.get("User Score"))
            scores = [s for s in [user_score, critic_score, community_score] if s is not None]
            best_score = max(scores) if scores else None
            year = year_from_date(release_date)
            hidden = any(tag.lower() == "[dh] hidden" for tag in tags)

            name = row.get("Name", "").strip()
            steam_appid = str(name_map.get(name, "") or "")
            steam_origin = "title-search" if steam_appid else "missing"
            # Newer Playnite exports include "Game Id": for Steam copies that is the
            # store's own app ID, so it replaces any title-search guess.
            playnite_game_id = (row.get("Game Id") or "").strip()
            if "Steam" in sources and re.fullmatch(r"[1-9]\d{0,14}", playnite_game_id):
                steam_appid, steam_origin = playnite_game_id, "playnite-game-id"
            # Optional explicit CSV fields retain their origin; they still need review.
            explicit_id = (row.get("Steam App ID") or row.get("SteamAppId") or "").strip()
            explicit_url = (row.get("Steam Store URL") or "").strip()
            if explicit_id and steam_origin != "playnite-game-id":
                steam_appid = explicit_id if re.fullmatch(r"[1-9]\d{0,14}", explicit_id) else ""
                steam_origin = "csv-steam-id" if steam_appid else "invalid-csv-steam-id"
            elif explicit_url and steam_origin != "playnite-game-id":
                match = re.fullmatch(r"https://store\.steampowered\.com/app/([1-9]\d{0,14})(?:/[^\s?#]*)?(?:[?#][^\s]*)?", explicit_url)
                steam_appid = match.group(1) if match else ""
                steam_origin = "csv-steam-url" if steam_appid else "invalid-csv-steam-url"
            if not re.fullmatch(r"[1-9]\d{0,14}", steam_appid):
                steam_appid = ""
            steam_payload = details.get(steam_appid, {}) if steam_appid else {}
            genres, genre_source = [], ""
            playnite_genres = steam_meta.clean_genres(split_list(row.get("Genres", "")))
            for source, names in (
                ("playnite", playnite_genres),
                ("igdb", igdb.get(name)),
                ("steam", steam_meta.clean_genres(steam_meta.genre_names(steam_payload))),
                ("wikidata", wikidata.get(name)),
            ):
                if names:
                    genres, genre_source = names, source
                    break

            search_blob = " ".join(
                [
                    row.get("Name", ""),
                    " ".join(platforms),
                    " ".join(sources),
                    " ".join(tags),
                    " ".join(categories),
                    " ".join(genres),
                    " ".join(developers),
                    " ".join(publishers),
                    clean_description(row.get("Description", ""), 500),
                ]
            ).lower()

            # The store's own id for this copy, so another source's copy of it is a duplicate.
            store_key = ""
            if playnite_game_id and sources:
                store = {"steam": "steam", "gog": "gog", "epic": "epic"}.get(sources[0].lower())
                if store:
                    store_key = f"{store}:{playnite_game_id}"
            rows.append(
                {
                    "id": game_id,
                    "storeKey": store_key,
                    "importSource": "playnite",
                    "lastPlayed": None,
                    "name": row.get("Name", "").strip() or "Untitled",
                    "categories": categories,
                    "genres": genres,
                    "genreSource": genre_source,
                    "steamAppId": steam_appid,
                    "steamAppIdProvenance": {"schemaVersion": 1, "origin": steam_origin, "trust": "store" if steam_origin == "playnite-game-id" else "candidate"},
                    "developers": developers,
                    "publishers": publishers,
                    "releaseDate": release_date,
                    "dateSort": sortable_date(release_date),
                    "year": year,
                    "platforms": platforms,
                    "playCount": play_count,
                    "timePlayed": time_played,
                    "sources": sources,
                    "tags": tags,
                    "communityScore": community_score,
                    "criticScore": critic_score,
                    "userScore": user_score,
                    "bestScore": best_score,
                    "scoreImport": {
                        "schemaVersion": 1,
                        "adapterVersion": "playnite-csv-scores-v1",
                        "checksum": hashlib.sha256(json.dumps({
                            "id": game_id, "platforms": platforms,
                            "Community Score": row.get("Community Score"),
                            "Critic Score": row.get("Critic Score"),
                            "User Score": row.get("User Score"),
                        }, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
                    },
                    "played": play_count > 0 or time_played > 0,
                    "hidden": hidden,
                    "summary": clean_description(row.get("Description", "")),
                    "cover": copy_media(media.get("cover", ""), game_id, cover_root, library_files, root),
                    "background": copy_media(media.get("background", ""), game_id, bg_root, library_files, root),
                    "search": search_blob,
                }
            )
    return rows


def read_source_rows(folder):
    """Games from connected sources (library/data/sources/*.json), as library rows."""
    igdb = steam_meta.load_igdb_genres()
    wikidata = steam_meta.load_wikidata_genres()
    rows = []
    for name in SOURCE_FILES:
        path = Path(folder) / name
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("schemaVersion") != 1 or data.get("kind") != "owned":
            raise ValueError(f"{path.name} is not a library source file. Import that source again.")
        for game in data.get("games", []):
            game_id, title = str(game.get("id") or ""), (game.get("name") or "").strip()
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", game_id) or not title:
                continue
            platforms, sources = list(game.get("platforms") or []), list(game.get("sources") or [])
            developers, publishers = list(game.get("developers") or []), list(game.get("publishers") or [])
            release_date = game.get("releaseDate") or ""
            time_played = int(game.get("timePlayed") or 0)
            play_count = int(game.get("playCount") or 0)
            genres, genre_source = [], ""
            for origin, names in (("source", steam_meta.clean_genres(game.get("genres") or [])), ("igdb", igdb.get(title)), ("wikidata", wikidata.get(title))):
                if names:
                    genres, genre_source = names, origin
                    break
            steam_appid = str(game.get("steamAppId") or "")
            steam_appid = steam_appid if re.fullmatch(r"[1-9]\d{0,14}", steam_appid) else ""
            summary = clean_description(game.get("summary") or "")
            rows.append({
                "id": game_id, "name": title, "storeKey": game.get("storeKey") or "", "importSource": data.get("source") or "source",
                "lastPlayed": game.get("lastPlayed"), "categories": [], "genres": genres, "genreSource": genre_source,
                "steamAppId": steam_appid,
                "steamAppIdProvenance": {"schemaVersion": 1, "origin": f"{data.get('source')}-store-id" if steam_appid else "missing", "trust": "store" if steam_appid else "candidate"},
                "developers": developers, "publishers": publishers, "releaseDate": release_date, "dateSort": sortable_date(release_date),
                "year": year_from_date(release_date), "platforms": platforms, "playCount": play_count, "timePlayed": time_played,
                "sources": sources, "tags": [], "communityScore": None, "criticScore": None, "userScore": None, "bestScore": None,
                "scoreImport": {"schemaVersion": 1, "adapterVersion": f"{data.get('source')}-source-v1", "checksum": hashlib.sha256(game_id.encode("utf-8")).hexdigest()},
                "played": play_count > 0 or time_played > 0, "hidden": bool(game.get("hidden")), "summary": summary,
                "cover": game.get("cover") or "", "background": game.get("background") or "",
                "search": " ".join([title, " ".join(platforms), " ".join(sources), " ".join(genres), " ".join(developers), " ".join(publishers), summary]).lower(),
            })
    return rows


def merge_rows(*groups):
    """Earlier groups win: a later row is dropped when an earlier one has the same store id,
    or the same title in the same store (stores' ids differ between apps for some games)."""
    seen, merged = set(), []
    for rows in groups:
        for row in rows:
            store = (row["sources"][0] if row["sources"] else "").lower()
            keys = {f"title:{store}:{title_key(row['name'])}"} | ({row["storeKey"]} if row.get("storeKey") else set())
            if row["importSource"] != "playnite" and keys & seen:
                continue
            seen |= keys
            merged.append(row)
    # Copy ids must stay unique; the first (higher-priority) row keeps its id.
    ids, unique = set(), []
    for row in merged:
        if row["id"] not in ids:
            ids.add(row["id"])
            unique.append(row)
    return unique


def group_titles(rows, previous=None):
    titles = []
    prior_by_id = {game["id"]: game for game in previous or []}
    for slug, key, copies, ancestors in plan_groups(rows, previous or [], slugify):
        # Show the best-played copy first; it's the most likely "primary" ownership.
        copies.sort(key=lambda c: (c["played"], c["timePlayed"], c["playCount"]), reverse=True)

        years = [c["year"] for c in copies if c["year"]]
        best_scores = [c["bestScore"] for c in copies if c["bestScore"] is not None]
        cover = next((c["cover"] for c in copies if c["cover"]), "")
        background = next((c["background"] for c in copies if c["background"]), "")
        summary = max((c["summary"] for c in copies), key=len, default="")
        date_sorts = sorted(c["dateSort"] for c in copies if c["dateSort"])

        titles.append(
            {
                "id": slug,
                "groupingVersion": 2,
                "groupingKey": key,
                "legacyGroups": ancestors,
                "notes": prior_by_id.get(slug, {}).get("notes", ""),
                "favorite": prior_by_id.get(slug, {}).get("favorite", False),
                "name": copies[0]["name"],
                "categories": dedupe(c for copy in copies for c in copy["categories"]),
                "genres": dedupe(g for copy in copies for g in copy["genres"]),
                "mainGenre": steam_meta.main_genre(dedupe(g for copy in copies for g in copy["genres"])),
                "genreSource": next((c["genreSource"] for c in copies if c["genreSource"]), ""),
                "steamAppId": copies[0]["steamAppId"] if len(copies) == 1 else "",
                "developers": dedupe(c for copy in copies for c in copy["developers"]),
                "publishers": dedupe(c for copy in copies for c in copy["publishers"]),
                "releaseDate": copies[0]["releaseDate"],
                "dateSort": date_sorts[0] if date_sorts else "",
                "year": min(years) if years else None,
                "platforms": dedupe(p for copy in copies for p in copy["platforms"]),
                "playCount": sum(c["playCount"] for c in copies),
                "timePlayed": sum(c["timePlayed"] for c in copies),
                "sources": dedupe(s for copy in copies for s in copy["sources"]),
                "tags": dedupe(t for copy in copies for t in copy["tags"]),
                "bestScore": max(best_scores) if best_scores else None,
                "played": any(c["played"] for c in copies),
                "hidden": all(c["hidden"] for c in copies),
                "summary": summary,
                "cover": cover,
                "background": background,
                "search": " ".join(dedupe(c["search"] for c in copies)),
                "duplicate": len(copies) > 1,
                "copies": [
                    {
                        "id": c["id"],
                        "name": c["name"],
                        "steamAppId": c["steamAppId"],
                        "steamAppIdProvenance": c["steamAppIdProvenance"],
                        "platforms": c["platforms"],
                        "sources": c["sources"],
                        "developers": c["developers"],
                        "releaseDate": c["releaseDate"],
                        "year": c["year"],
                        "playCount": c["playCount"],
                        "timePlayed": c["timePlayed"],
                        "bestScore": c["bestScore"],
                        "communityScore": c["communityScore"],
                        "criticScore": c["criticScore"],
                        "userScore": c["userScore"],
                        "scoreImport": c["scoreImport"],
                        "played": c["played"],
                        "hidden": c["hidden"],
                        "importSource": c.get("importSource", "playnite"),
                        **({"lastPlayed": c["lastPlayed"]} if c.get("lastPlayed") else {}),
                    }
                    for c in copies
                ],
            }
        )
    return titles


def apply_overrides(titles, overrides):
    for title in titles:
        for ancestor in title.get("legacyGroups", []):
            edit = overrides.get(ancestor["id"], {})
            for field in ["notes", "favorite", "hidden"]:
                if field in edit:
                    ancestor[field] = edit[field]
        title.setdefault("favorite", False)
        title.setdefault("notes", "")
        override = overrides.get(title["id"])
        if not override:
            continue
        if override.get("nameOverride"):
            title["name"] = override["nameOverride"]
        if "hidden" in override:
            title["hidden"] = bool(override["hidden"])
        if override.get("cover"):
            title["cover"] = override["cover"]
        if override.get("background"):
            title["background"] = override["background"]
        title["favorite"] = bool(override.get("favorite", title["favorite"]))
        title["notes"] = override.get("notes", title["notes"])
    return titles


def build_stats(titles):
    platform_counts = Counter()
    source_counts = Counter()
    tag_counts = Counter()
    category_counts = Counter()
    genre_counts = Counter()
    main_genre_counts = Counter()
    developer_counts = Counter()
    publisher_counts = Counter()
    years = []
    total_seconds = 0
    duplicate_titles = 0
    duplicate_copies = 0

    for title in titles:
        for item in title["platforms"]:
            platform_counts[item] += 1
        for item in title["sources"]:
            source_counts[item] += 1
        for item in title["tags"]:
            tag_counts[item] += 1
        for item in title["categories"]:
            category_counts[item] += 1
        for item in title["genres"]:
            genre_counts[item] += 1
        main_genre_counts[title["mainGenre"]] += 1
        for item in title["developers"]:
            developer_counts[item] += 1
        for item in title["publishers"]:
            publisher_counts[item] += 1
        if title["year"]:
            years.append(title["year"])
        total_seconds += title["timePlayed"]
        if title["duplicate"]:
            duplicate_titles += 1
            duplicate_copies += len(title["copies"]) - 1

    return {
        "total": len(titles),
        "totalCopies": sum(len(t["copies"]) for t in titles),
        "played": sum(1 for t in titles if t["played"]),
        "hidden": sum(1 for t in titles if t["hidden"]),
        "favorites": sum(1 for t in titles if t["favorite"]),
        "withCovers": sum(1 for t in titles if t["cover"]),
        "withBackgrounds": sum(1 for t in titles if t["background"]),
        # Playnite's "Time Played" column is in seconds.
        "totalHours": round(total_seconds / 3600),
        "duplicateTitles": duplicate_titles,
        "duplicateCopies": duplicate_copies,
        "platforms": platform_counts.most_common(),
        "sources": source_counts.most_common(),
        "tags": tag_counts.most_common(80),
        "categories": category_counts.most_common(),
        "genres": genre_counts.most_common(),
        "mainGenres": main_genre_counts.most_common(),
        "withGenres": sum(1 for t in titles if t["genres"]),
        "developers": developer_counts.most_common(60),
        "publishers": publisher_counts.most_common(60),
        "yearMin": min(years) if years else None,
        "yearMax": max(years) if years else None,
    }


def build():
    args = parse_args()
    previous = read_previous(args.previous or args.out)
    library_files = args.backup_root / "libraryfiles"
    games_db = args.backup_root / "library" / "games.db"

    media_refs = extract_media_refs(games_db)
    cover_root = ROOT / "assets" / "covers"
    bg_root = ROOT / "assets" / "backgrounds"

    playnite_rows = read_rows(args.csv, media_refs, cover_root, bg_root, library_files, ROOT) if args.csv.exists() else []
    sources = getattr(args, "sources", None)
    rows = merge_rows(playnite_rows, read_source_rows(sources) if sources else [])
    if not rows:
        raise ValueError("No games found: export your Playnite library or connect a source. The existing snapshot was kept.")
    titles = group_titles(rows, previous)
    overrides = load_overrides(OVERRIDES_PATH)
    titles = apply_overrides(titles, overrides)
    stats = build_stats(titles)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.out.with_suffix(".tmp")
    temporary.write_text(
        "window.PLAYNITE_LIBRARY = "
        + json.dumps(titles, ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.PLAYNITE_STATS = "
        + json.dumps(stats, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    # Keep a byte-for-byte recovery copy before changing existing group scopes.
    # Content-addressing avoids overwriting an earlier recovery snapshot.
    if args.out.exists():
        existing = read_previous(args.out)
        membership = lambda games: {c["id"]: g["id"] for g in games for c in g["copies"]}
        if membership(existing) != membership(titles):
            original = args.out.read_bytes()
            recovery = args.out.with_name(f"{args.out.stem}.before-regrouping-{hashlib.sha256(original).hexdigest()[:16]}.js")
            if recovery.exists():
                if recovery.read_bytes() != original:
                    raise ValueError("The recovery snapshot differs. The existing library was kept.")
            else:
                with recovery.open("xb") as handle:
                    handle.write(original)
            print(f"Previous snapshot preserved at {recovery}")
    temporary.replace(args.out)
    print(f"Built {stats['total']} titles from {stats['totalCopies']} copies; {stats['withCovers']} covers retained.")


if __name__ == "__main__":
    build()
