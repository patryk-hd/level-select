import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "library" / "tools"))
import build_site


def source_file(folder, name, source, games):
    (Path(folder) / name).write_text(json.dumps({"schemaVersion": 1, "kind": "owned", "source": source, "importedAt": "now", "games": games}), encoding="utf-8")


class SourceRowsTests(unittest.TestCase):
    def test_sources_become_rows_and_the_same_game_in_the_same_store_appears_once(self):
        with tempfile.TemporaryDirectory() as folder, patch.multiple(build_site.steam_meta, load_igdb_genres=lambda: {}, load_wikidata_genres=lambda: {}):
            source_file(folder, "galaxy.json", "galaxy", [
                {"id": "steam-620", "name": "Portal 2", "platforms": ["PC (Windows)"], "sources": ["Steam"], "steamAppId": "620", "storeKey": "steam:620", "releaseDate": "2011-04-19", "timePlayed": 60, "playCount": 1, "genres": ["Puzzle"]},
                {"id": "epic-Flier", "name": "Gone Home™", "platforms": ["PC (Windows)"], "sources": ["Epic"], "storeKey": "epic:Flier"},
                {"id": "gog-1", "name": "Galaxy only", "platforms": ["PC (Windows)"], "sources": ["GOG"], "storeKey": "gog:1", "hidden": True},
            ])
            source_file(folder, "steam-owned.json", "steam", [
                {"id": "steam-620", "name": "Portal 2", "platforms": ["PC (Windows)"], "sources": ["Steam"], "steamAppId": "620", "storeKey": "steam:620"},
                {"id": "steam-400", "name": "Portal", "platforms": ["PC (Windows)"], "sources": ["Steam"], "steamAppId": "400", "storeKey": "steam:400"},
            ])
            rows = build_site.read_source_rows(folder)
            self.assertEqual([row["id"] for row in rows], ["steam-620", "epic-Flier", "gog-1", "steam-620", "steam-400"])
            portal = rows[0]
            self.assertEqual((portal["year"], portal["genres"], portal["played"], portal["importSource"], portal["steamAppIdProvenance"]["trust"]), (2011, ["Puzzle"], True, "galaxy", "store"))
            self.assertTrue(rows[2]["hidden"])
            # Playnite has Gone Home on Epic (by title) and Portal 2 on Steam (by store id): those stay Playnite's.
            playnite = [dict(rows[0], id="p1", importSource="playnite", name="Portal 2", storeKey="steam:620"),
                        dict(rows[1], id="p2", importSource="playnite", name="Gone Home", storeKey="")]
            merged = build_site.merge_rows(playnite, rows)
            self.assertEqual([row["id"] for row in merged], ["p1", "p2", "gog-1", "steam-400"])

    def test_installed_steam_games_only_add_games_no_other_source_has(self):
        with tempfile.TemporaryDirectory() as folder, patch.multiple(build_site.steam_meta, load_igdb_genres=lambda: {}, load_wikidata_genres=lambda: {}):
            source_file(folder, "steam-owned.json", "steam", [
                {"id": "steam-400", "name": "Portal", "platforms": ["PC (Windows)"], "sources": ["Steam"], "steamAppId": "400", "storeKey": "steam:400", "timePlayed": 600, "playCount": 1},
            ])
            source_file(folder, "steam-installed.json", "steam-installed", [
                {"id": "steam-400", "name": "Portal", "platforms": ["PC (Windows)"], "sources": ["Steam"], "steamAppId": "400", "storeKey": "steam:400"},
                {"id": "steam-620", "name": "Portal 2", "platforms": ["PC (Windows)"], "sources": ["Steam", "Family Sharing"], "steamAppId": "620", "storeKey": "steam:620", "lastPlayed": "2023-11-14T22:13:20.000Z", "playCount": 1},
            ])
            merged = build_site.merge_rows([], build_site.read_source_rows(folder))
            self.assertEqual([(row["id"], row["importSource"], row["timePlayed"]) for row in merged], [("steam-400", "steam", 600), ("steam-620", "steam-installed", 0)])
            self.assertEqual((merged[1]["sources"], merged[1]["played"]), (["Steam", "Family Sharing"], True))

    def test_a_file_that_is_not_a_source_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "galaxy.json").write_text('{"schemaVersion": 1, "kind": "roms", "games": []}', encoding="utf-8")
            with self.assertRaises(ValueError):
                build_site.read_source_rows(folder)


if __name__ == "__main__":
    unittest.main()
