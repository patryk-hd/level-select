import csv
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "library" / "tools"))
import build_site


class NewPlayniteColumnsTests(unittest.TestCase):
    def test_game_id_is_the_steam_app_id_for_steam_copies_and_genres_are_used(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            export = root / "library.csv"
            with export.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["Id", "Name", "Platforms", "Sources", "Game Id", "Genres"])
                writer.writeheader()
                writer.writerows([
                    {"Id": "a", "Name": "Hades", "Platforms": "PC (Windows)", "Sources": "Steam", "Game Id": "1145360", "Genres": "Role-playing (RPG), Indie"},
                    {"Id": "b", "Name": "Hades", "Platforms": "PC (Windows)", "Sources": "Epic", "Game Id": "98614687b212444c9ff0d42095f56cb3", "Genres": ""},
                ])
            # The title-search map would suggest a different id; the store id wins.
            with patch.multiple(build_site.steam_meta, load_igdb_genres=lambda: {}, load_name_map=lambda: {"Hades": "999"}, load_details_cache=lambda: {}, load_wikidata_genres=lambda: {}):
                rows = {row["id"]: row for row in build_site.read_rows(export, {}, root / "covers", root / "backgrounds", root / "files", root)}
            self.assertEqual(rows["a"]["steamAppId"], "1145360")
            self.assertEqual(rows["a"]["steamAppIdProvenance"], {"schemaVersion": 1, "origin": "playnite-game-id", "trust": "store"})
            self.assertEqual(rows["a"]["genres"], ["Role-playing (RPG)", "Indie"])
            self.assertEqual(rows["a"]["genreSource"], "playnite")
            # An Epic copy's Game Id is not a Steam id; it keeps the older title-search candidate.
            self.assertEqual(rows["b"]["steamAppIdProvenance"]["origin"], "title-search")


if __name__ == "__main__":
    unittest.main()
