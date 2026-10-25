"""Conservative browsing groups, with explicit lineage for old group notes.

Grouping never confirms a provider match or combines tracking histories.
"""
import hashlib
import json
import re
from copy import deepcopy


def normalized(value):
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def group_key(copy):
    # Missing facts do not establish equivalence. Keep those copies separate.
    platforms = sorted({normalized(p) for p in copy.get("platforms", []) if normalized(p)})
    developers = sorted({normalized(d) for d in copy.get("developers", []) if normalized(d)})
    year = copy.get("year")
    identity = [normalized(copy["name"]), year, platforms, developers]
    if not year or not platforms or not developers:
        identity.append(copy["id"])
    # Even candidate IDs may expose a conflict; they never prove equivalence.
    product = copy.get("steamAppId")
    identity.append(str(product) if product else None)
    return json.dumps(identity, ensure_ascii=False, separators=(",", ":"))


def read_previous(path):
    if not path.exists():
        return []
    try:
        source = path.read_text(encoding="utf-8")
        prefix = re.match(r"\s*window\.PLAYNITE_LIBRARY\s*=\s*", source)
        if not prefix:
            raise ValueError("Missing library assignment")
        data, _ = json.JSONDecoder().raw_decode(source[prefix.end():])
        if not isinstance(data, list):
            raise ValueError("Expected a library array")
        ids, copies = set(), set()
        for game in data:
            if not isinstance(game, dict) or not isinstance(game.get("id"), str) or not game["id"] or game["id"] in ids:
                raise ValueError("Invalid or duplicate group ID")
            ids.add(game["id"])
            if not isinstance(game.get("copies"), list) or not game["copies"]:
                raise ValueError("Missing copy IDs")
            for copy in game["copies"]:
                if not isinstance(copy, dict) or not isinstance(copy.get("id"), str) or not copy["id"] or copy["id"] in copies:
                    raise ValueError("Invalid or duplicate copy ID")
                copies.add(copy["id"])
            if not isinstance(game.get("legacyGroups", []), list):
                raise ValueError("Invalid group lineage")
        return data
    except (ValueError, TypeError, KeyError, OSError) as error:
        raise ValueError("Cannot read the previous library for safe regrouping. The snapshot was kept; restore a valid snapshot or use --previous with a valid file.") from error


def legacy_record(game):
    return {"id": game["id"], "name": game["name"],
            "copyIds": sorted(c["id"] for c in game["copies"]),
            "notes": game.get("notes", ""), "favorite": game.get("favorite", False),
            "hidden": game.get("hidden", False)}


def plan_groups(rows, previous, slugify):
    partitions = {}
    for row in rows:
        partitions.setdefault(group_key(row), []).append(row)
    # Reconstruct the old name-only groups when there is no previous snapshot.
    # This also keeps pre-existing browser overrides recoverable on a fresh build.
    if not previous:
        old, used = {}, set()
        for row in rows:
            old.setdefault(normalized(row["name"]), []).append(row)
        previous = []
        for name, copies in old.items():
            base = slugify(name)
            identifier, suffix = base, 2
            while identifier in used:
                identifier, suffix = f"{base}-{suffix}", suffix + 1
            used.add(identifier)
            previous.append({"id": identifier, "name": copies[0]["name"], "copies": copies})

    by_copy = {c["id"]: g for g in previous for c in g["copies"]}
    results = []
    for key, copies in partitions.items():
        ids = {c["id"] for c in copies}
        parents = {by_copy[c]["id"]: by_copy[c] for c in ids if c in by_copy}
        # Reuse only a whole parent's group. A split must not give the old notes
        # to one arbitrary child. Corrected v2 identity also gets a new scope.
        reusable = [g for g in parents.values()
                    if {c["id"] for c in g["copies"]}.issubset(ids)
                    and (not g.get("groupingKey") or g["groupingKey"] == key)]
        reuse = reusable[0] if len(parents) == 1 and len(reusable) == 1 else None
        identifier = reuse["id"] if reuse else "release-" + hashlib.sha256(
            json.dumps([key, sorted(ids)], ensure_ascii=False).encode()).hexdigest()[:24]
        if not reuse:
            # A repeated earlier partition can legitimately recover its old ID.
            if identifier in {g["id"] for g in previous}:
                raise ValueError("Conflicting release group identifier. The snapshot was kept.")
        ancestors = {}
        for parent in parents.values():
            for ancestor in parent.get("legacyGroups", []):
                if ancestor["id"] != identifier:
                    ancestors[ancestor["id"]] = deepcopy(ancestor)
            if parent["id"] != identifier:
                ancestors[parent["id"]] = legacy_record(parent)
        results.append((identifier, key, sorted(copies, key=lambda c: c["id"]),
                        sorted(ancestors.values(), key=lambda g: g["id"])))
    return results
