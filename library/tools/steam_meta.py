"""Shared helpers for turning cached Steam store payloads into site data.

Used by both build_wishlist.py (wishlist page) and build_site.py (library
genres), so the genre vocabulary stays identical across the two pages.
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DETAILS_CACHE = ROOT / "data" / "cache" / "steam-appdetails.jsonl"
NAME_MAP_CACHE = ROOT / "data" / "cache" / "steam-name-map.jsonl"
WIKIDATA_CACHE = ROOT / "data" / "cache" / "wikidata-genres.jsonl"
WIKIDATA_LABELS = ROOT / "data" / "cache" / "wikidata-labels.json"
IGDB_CACHE = ROOT / "data" / "cache" / "igdb-genres.jsonl"

EDITION_SUFFIXES = (
    "game of the year edition",
    "definitive edition",
    "complete edition",
    "enhanced edition",
    "deluxe edition",
    "ultimate edition",
    "goty edition",
    "remastered",
)

# Steam hands back an unordered genre list where "Indie" and "Action" sit next
# to each other. To get one useful "main category" per game, the most specific
# genre wins; the catch-all labels only apply when nothing else is present.
GENRE_PRIORITY = [
    "Massively Multiplayer",
    "RPG",
    "Strategy",
    "Simulation",
    "Racing",
    "Sports",
    "Adventure",
    "Action",
    "Casual",
    "Indie",
]

# Genre entries that describe content warnings or store status rather than the
# kind of game it is.
GENRE_NOISE = {
    "Early Access",
    "Free to Play",
    "Gore",
    "Violent",
    "Nudity",
    "Sexual Content",
    "Utilities",
    "Animation & Modeling",
    "Design & Illustration",
    "Audio Production",
    "Video Production",
    "Photo Editing",
    "Game Development",
    "Software Training",
    "Web Publishing",
    "Education",
    "Accounting",
    "Movie",
    "Documentary",
    "Short",
    "Episodic",
}

# Steam "categories" are mostly platform plumbing (Trading Cards, Cloud, Remote
# Play). Only the ones that change how a game is played are worth surfacing.
FEATURE_WHITELIST = {
    "Single-player": "Single-player",
    "Multi-player": "Multiplayer",
    "PvP": "PvP",
    "Online PvP": "Online PvP",
    "Co-op": "Co-op",
    "Online Co-op": "Online Co-op",
    "Shared/Split Screen": "Split screen",
    "Shared/Split Screen Co-op": "Split screen co-op",
    "Full controller support": "Full controller",
    "Partial Controller Support": "Partial controller",
    "Steam Achievements": "Achievements",
    "Steam Workshop": "Workshop",
    "VR Supported": "VR supported",
    "VR Only": "VR only",
}


STORE_SETTINGS = Path(__file__).resolve().parents[1] / "data" / "store.json"


def load_store(path=STORE_SETTINGS):
    """Which Steam store to use for prices: library/data/store.json, default UK/GBP."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        country, currency = str(data.get("country", "gb")).lower(), str(data.get("currency", "GBP")).upper()
        if re.fullmatch(r"[a-z]{2}", country) and re.fullmatch(r"[A-Z]{3}", currency):
            return {"country": country, "currency": currency}
    except (OSError, ValueError, AttributeError):
        pass
    return {"country": "gb", "currency": "GBP"}


def load_details_cache(path=DETAILS_CACHE):
    cache = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("ok") and record.get("data"):
                cache[str(record["appid"])] = {**record["data"], "_fetchedAt": record.get("fetchedAt")}
    return cache


def load_name_map(path=NAME_MAP_CACHE):
    mapping = {}
    if not path.exists():
        return mapping
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("appid"):
                mapping[record["name"]] = str(record["appid"])
    return mapping


# Wikidata describes genres far more finely than Steam does ("kart racing
# game", "action role-playing game", "metroidvania"). Each keyword contributes
# one of the coarse buckets above, and a label can contribute several — an
# "action-adventure game" counts as both Action and Adventure, exactly as Steam
# would tag it — so that the main category comes out the same either way.
GENRE_KEYWORDS = [
    ("massively multiplayer", "Massively Multiplayer"),
    ("mmo", "Massively Multiplayer"),
    ("role-playing", "RPG"),
    ("roleplaying", "RPG"),
    ("rpg", "RPG"),
    ("roguelike", "RPG"),
    ("roguelite", "RPG"),
    ("dungeon crawl", "RPG"),
    ("soulslike", "RPG"),
    ("soulslike", "Action"),
    ("strategy", "Strategy"),
    ("tactic", "Strategy"),
    ("4x", "Strategy"),
    ("tower defense", "Strategy"),
    ("wargame", "Strategy"),
    ("multiplayer online battle arena", "Strategy"),
    ("moba", "Strategy"),
    ("auto battler", "Strategy"),
    ("god game", "Strategy"),
    ("simulat", "Simulation"),
    ("management", "Simulation"),
    ("tycoon", "Simulation"),
    ("city-building", "Simulation"),
    ("city building", "Simulation"),
    ("farming", "Simulation"),
    ("sandbox", "Simulation"),
    ("racing", "Racing"),
    ("driving", "Racing"),
    ("kart", "Racing"),
    ("sport", "Sports"),
    ("football", "Sports"),
    ("soccer", "Sports"),
    ("basketball", "Sports"),
    ("baseball", "Sports"),
    ("golf", "Sports"),
    ("tennis", "Sports"),
    ("wrestling", "Sports"),
    ("skateboard", "Sports"),
    ("snowboard", "Sports"),
    ("action", "Action"),
    ("shooter", "Action"),
    ("shoot 'em up", "Action"),
    ("shmup", "Action"),
    ("run and gun", "Action"),
    ("platform", "Action"),
    ("beat 'em up", "Action"),
    ("hack and slash", "Action"),
    ("fighting", "Action"),
    ("stealth", "Action"),
    ("metroidvania", "Action"),
    ("battle royale", "Action"),
    ("survival", "Action"),
    ("horror", "Action"),
    ("arcade", "Action"),
    ("adventure", "Adventure"),
    ("visual novel", "Adventure"),
    ("interactive fiction", "Adventure"),
    ("point-and-click", "Adventure"),
    ("point and click", "Adventure"),
    ("walking simulator", "Adventure"),
    ("graphic adventure", "Adventure"),
    ("text-based", "Adventure"),
    ("puzzle", "Casual"),
    ("party", "Casual"),
    ("rhythm", "Casual"),
    ("music", "Casual"),
    ("pinball", "Casual"),
    ("card", "Casual"),
    ("board game", "Casual"),
    ("casual", "Casual"),
    ("idle", "Casual"),
    ("clicker", "Casual"),
    ("trivia", "Casual"),
    ("educational", "Casual"),
    ("indie", "Indie"),
]


def genre_names(payload):
    return [g.get("description") for g in (payload.get("genres") or []) if g.get("description")]


def clean_genres(names):
    return [name for name in names if name not in GENRE_NOISE]


def tidy_label(label):
    """"action-adventure game" -> "Action-adventure"."""
    text = re.sub(r"\s+", " ", (label or "").strip())
    text = re.sub(r"\s+(video\s+)?game$", "", text, flags=re.I)
    if not text:
        return ""
    return text[0].upper() + text[1:]


def buckets_for(label):
    key = (label or "").lower()
    return {bucket for keyword, bucket in GENRE_KEYWORDS if keyword in key}


def main_genre(names):
    """The single coarse category for a game, from either metadata source."""
    usable = clean_genres(names)
    buckets = set()
    for name in usable:
        buckets |= buckets_for(name)
    for genre in GENRE_PRIORITY:
        if genre in buckets:
            return genre
    # Anything that maps to no bucket is a theme ("Romance") or a bad match
    # rather than a category worth its own entry in the filter.
    return "Unclassified"


def load_igdb_genres():
    """{title: [genre name, ...]} from tools/igdb_genres.py."""
    genres = {}
    if not IGDB_CACHE.exists():
        return genres
    with IGDB_CACHE.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            names = [tidy_label(name) for name in (record.get("genres") or [])]
            names = [name for name in names if name]
            if names:
                genres[record["name"]] = names
    return genres


def load_wikidata_genres():
    """{title: [genre label, ...]} for titles the Steam store couldn't classify."""
    if not WIKIDATA_CACHE.exists():
        return {}
    labels = {}
    if WIKIDATA_LABELS.exists():
        try:
            labels = json.loads(WIKIDATA_LABELS.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            labels = {}

    genres = {}
    with WIKIDATA_CACHE.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            names = []
            for gid in record.get("genreIds") or []:
                label = tidy_label(labels.get(gid, ""))
                if label and label not in names:
                    names.append(label)
            if names:
                genres[record["name"]] = names
    return genres


def features(payload):
    labels = []
    for category in payload.get("categories") or []:
        label = FEATURE_WHITELIST.get(category.get("description"))
        if label and label not in labels:
            labels.append(label)
    return labels


def strip_html(value, limit=400):
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "..."


def wilson_lower_bound(positive_pct, count, z=1.96):
    """Lower bound of the 95% confidence interval for the positive rate.

    A 96%-positive game with 40 reviews is a far weaker signal than a
    92%-positive game with 40,000, and this is the standard way to say so.
    """
    if (type(count) is not int or count <= 0 or type(positive_pct) not in (int, float)
            or not math.isfinite(positive_pct) or not 0 <= positive_pct <= 100):
        return None
    phat = positive_pct / 100
    n = float(count)
    denominator = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)
    return max(0.0, (centre - margin) / denominator)


def popularity(count):
    """0-1 scale where ~1,000,000 reviews saturates."""
    if not count:
        return 0.0
    return min(1.0, math.log10(count + 10) / 6.0)


def pick_score(positive_pct, count):
    """Conservative approval only; rounded percentages make this approximate."""
    return wilson_lower_bound(positive_pct, count)


def legacy_pick_score(positive_pct, count):
    """Compatibility value only. Never used as current reception order."""
    lower = wilson_lower_bound(positive_pct, count)
    return round(0.7 * lower + 0.3 * popularity(count), 4) if lower is not None else None
