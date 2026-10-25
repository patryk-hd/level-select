#!/usr/bin/env python3
"""Merge the Steam wishlist export with cached store metadata into site data.

  ./tools/build_wishlist.py --wishlist steam-wishlist.json

Run tools/steam_enrich.py first so genres are available; entries with no cached
metadata still appear, just filed under "Unclassified".
"""
import argparse
import json
import re
import math
from collections import Counter
from pathlib import Path
from datetime import datetime, timezone

import steam_meta as meta

ROOT = Path(__file__).resolve().parents[1]
STORE = meta.load_store()
DEFAULT_WISHLIST = ROOT / "steam-wishlist.json"
DEFAULT_OUT = ROOT / "data" / "wishlist-data.js"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--wishlist", type=Path, default=DEFAULT_WISHLIST)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--prefer-igdb",
        action="store_true",
        help="Use IGDB genres ahead of Steam's, so both pages share one genre source. "
        "Requires ./tools/igdb_genres.py --wishlist to have run.",
    )
    return parser.parse_args()


def sortable_date(value):
    """Wishlist dates are M/D/YYYY; Steam store dates are '13 Nov, 2024'."""
    value = (value or "").strip()
    if not value:
        return ""
    parts = re.split(r"[/-]", value)
    if len(parts) >= 3 and all(p.strip().isdigit() for p in parts[:3]):
        month, day, year = parts[:3]
        if len(parts[0]) == 4:
            year, month, day = parts[:3]
        try:
            return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
        except ValueError:
            return ""
    return ""


def year_of(value):
    match = re.search(r"(19|20)\d{2}", value or "")
    return int(match.group(0)) if match else None


SYMBOLS = {"£": "GBP", "€": "EUR", "$": "USD", "GBP": "GBP", "EUR": "EUR", "USD": "USD", "CAD": "CAD", "AUD": "AUD"}


def parse_price_text(price_text):
    """'£49.99' → (4999, 'GBP'); '16,75€' → (1675, 'EUR'); '1.299,00€' → (129900, 'EUR')."""
    text = (price_text or "").strip()
    currency = next((code for symbol, code in SYMBOLS.items() if symbol in text), None)
    number = re.sub(r"[^\d.,]", "", text)
    if not currency or not re.search(r"\d", number):
        return None, currency
    last = max(number.rfind(","), number.rfind("."))
    if last >= 0 and len(number) - last - 1 in (1, 2):
        whole, fraction = re.sub(r"[.,]", "", number[:last]), number[last + 1:].ljust(2, "0")
    else:
        whole, fraction = re.sub(r"[.,]", "", number), "00"
    return int(whole or "0") * 100 + int(fraction), currency


def price_pence(price_text, payload, currency="GBP"):
    """Price in minor units of the store currency (library/data/store.json), else None."""
    overview = payload.get("price_overview") or {}
    if overview.get("final") is not None and overview.get("currency") == currency:
        return int(overview["final"])
    if payload.get("is_free"):
        return 0
    amount, found = parse_price_text(price_text)
    return amount if found == currency else None


def price_snapshot(game, payload):
    """Use the observation date of this price, never the date we rebuild the site."""
    overview = payload.get("price_overview") or {}
    amount, currency = overview.get("final"), overview.get("currency")
    observed = payload.get("_fetchedAt")
    source = "steam-store-cache"
    if type(amount) is not int or amount < 0 or not re.fullmatch(r"[A-Z]{3}", currency or ""):
        original = game.get("price_snapshot")
        if not isinstance(original, dict):
            original = {}
        amount, currency, observed = original.get("amountMinor"), original.get("currency"), original.get("observedAt")
        source = "wishlist-export"
    if type(amount) is not int or amount < 0 or not re.fullmatch(r"[A-Z]{3}", currency or ""):
        return None
    try:
        parsed = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Missing timezone")
        observed = parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (AttributeError, TypeError, ValueError):
        observed = None
    return {"amountMinor": amount, "currency": currency, "observedAt": observed, "source": source}


def appid_of(game):
    gameid = game.get("gameid") or []
    if len(gameid) == 2 and gameid[0] == "steam":
        match = re.search(r"(\d+)", gameid[1])
        if match:
            return match.group(1)
    return ""


def review_snapshot(reviews):
    """Keep exact counts only when supplied together; never invent them from %."""
    reviews = reviews if isinstance(reviews, dict) else {}
    def number(value, integer=False):
        if value is None or isinstance(value, bool) or value == "":
            return None
        try:
            result = float(value)
            if not math.isfinite(result) or result < 0 or (integer and (not result.is_integer() or result > 9007199254740991)):
                return None
            return int(result) if integer else result
        except (TypeError, ValueError):
            return None
    total = number(reviews.get("count"), True)
    positive, negative = number(reviews.get("positive"), True), number(reviews.get("negative"), True)
    pct = number(reviews.get("percPositive"))
    pct = pct if pct is not None and pct <= 100 else None
    has_counts = reviews.get("positive") is not None or reviews.get("negative") is not None
    consistent = positive is not None and negative is not None and total is not None and positive + negative == total
    if consistent and total:
        pct = 100 * positive / total
    elif has_counts:
        pct = None
    if total == 0:
        pct = None
    observed = reviews.get("observedAt")
    try:
        date = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if date.tzinfo is None:
            raise ValueError("Timezone required")
        observed = date.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (AttributeError, TypeError, ValueError):
        observed = None
    return {"schemaVersion": 1, "provider": "steam-wishlist-import", "total": total,
            "percentage": pct, "positive": positive if consistent else None, "negative": negative if consistent else None,
            "observedAt": observed, "queryScope": reviews.get("queryScope") if isinstance(reviews.get("queryScope"), dict) else None,
            "countMeaning": "Imported review population; query settings unknown" if not reviews.get("queryScope") else "Imported review query population",
            "adapterVersion": "steam-wishlist-scores-v1", "raw": reviews}


def build_entries(wishlist, cache, fallback, prefer_fallback=False):
    entries = []
    for game in wishlist:
        appid = appid_of(game)
        payload = cache.get(appid, {})
        reviews = review_snapshot(game.get("reviews"))
        count, pct = reviews["total"], reviews["percentage"]
        title = payload.get("name") or game.get("title") or "Untitled"
        original = game.get("title", "")
        steam_genres = meta.clean_genres(meta.genre_names(payload))
        other_genres = fallback.get(title) or fallback.get(original) or []
        # Steam is the default here because it classifies every wishlisted app;
        # the fallback covers delisted or region-locked ones, and takes over
        # entirely with --prefer-igdb so both pages share one genre source.
        order = (other_genres, steam_genres) if prefer_fallback else (steam_genres, other_genres)
        genres = next((names for names in order if names), [])
        release_date = payload.get("release_date", {}).get("date") or game.get("release_date") or ""
        metacritic = (payload.get("metacritic") or {}).get("score")
        pence = price_pence(game.get("price"), payload, STORE["currency"])

        entries.append(
            {
                "appid": appid,
                "title": title,
                "url": game.get("url") or (f"https://store.steampowered.com/app/{appid}/" if appid else ""),
                "image": payload.get("header_image")
                or (f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg" if appid else ""),
                "addedDate": game.get("added_date") or "",
                "addedSort": sortable_date(game.get("added_date")),
                "releaseDate": release_date,
                # Kept verbatim so an exported trimmed wishlist stays in the
                # same date format as the file Steam handed out.
                "releaseRaw": game.get("release_date") or "",
                "releaseSort": sortable_date(game.get("release_date")),
                "year": year_of(release_date) or year_of(game.get("release_date")),
                "comingSoon": bool((payload.get("release_date") or {}).get("coming_soon")),
                "price": game.get("price") or ("Free" if payload.get("is_free") else ""),
                "pricePence": pence,
                "priceSnapshot": price_snapshot(game, payload),
                "discount": int(game.get("discount") or 0),
                "reviewCount": count,
                "reviewPct": pct,
                "reviewEvidence": reviews,
                "metacritic": metacritic,
                "genres": genres,
                "mainGenre": meta.main_genre(genres),
                "features": meta.features(payload),
                "developers": payload.get("developers") or [],
                "publishers": payload.get("publishers") or [],
                "summary": meta.strip_html(payload.get("short_description")),
                "type": payload.get("type") or "",
                "note": game.get("note") or "",
                "enriched": bool(payload),
                "pickScore": meta.pick_score(pct, count),
                "legacyPickScore": meta.legacy_pick_score(pct, count),
                "rankingMethod": "steam-wilson-counts-v1" if reviews["positive"] is not None else "steam-wilson-approx-v1",
                "search": " ".join(
                    [
                        title,
                        " ".join(genres),
                        " ".join(payload.get("developers") or []),
                        " ".join(payload.get("publishers") or []),
                        meta.strip_html(payload.get("short_description"), 600),
                    ]
                ).lower(),
            }
        )
    return entries


def build_stats(entries):
    genre_counts = Counter()
    main_counts = Counter()
    feature_counts = Counter()
    years = [e["year"] for e in entries if e["year"]]
    priced = [e["pricePence"] for e in entries if e["pricePence"] is not None]
    rated = [e["reviewPct"] for e in entries if e["reviewPct"] is not None]

    for entry in entries:
        for genre in entry["genres"]:
            genre_counts[genre] += 1
        main_counts[entry["mainGenre"]] += 1
        for feature in entry["features"]:
            feature_counts[feature] += 1

    return {
        "total": len(entries),
        "enriched": sum(1 for e in entries if e["enriched"]),
        "onSale": sum(1 for e in entries if e["discount"] > 0),
        "comingSoon": sum(1 for e in entries if e["comingSoon"]),
        "totalPence": sum(priced),
        "currency": STORE["currency"],
        "avgReviewPct": round(sum(rated) / len(rated)) if rated else None,
        "ratedCount": len(rated),
        "genres": genre_counts.most_common(),
        "mainGenres": main_counts.most_common(),
        "features": feature_counts.most_common(),
        "yearMin": min(years) if years else None,
        "yearMax": max(years) if years else None,
    }


def build():
    args = parse_args()
    wishlist = json.loads(args.wishlist.read_text(encoding="utf-8")).get("data", [])
    cache = meta.load_details_cache()
    # IGDB first, then Wikidata, for the few apps Steam can't describe.
    fallback = {**meta.load_wikidata_genres(), **meta.load_igdb_genres()}
    entries = build_entries(wishlist, cache, fallback, args.prefer_igdb)
    entries.sort(key=lambda e: (e["pickScore"] is None, -(e["pickScore"] or 0), e["title"].lower()))
    stats = build_stats(entries)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        "window.STEAM_WISHLIST = "
        + json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.WISHLIST_STATS = "
        + json.dumps(stats, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(
        f"{stats['total']} wishlist games written to {args.out.relative_to(ROOT)} "
        f"({stats['enriched']} with Steam metadata)."
    )
    print("Main genres:", ", ".join(f"{name} ({count})" for name, count in stats["mainGenres"][:12]))


if __name__ == "__main__":
    build()
