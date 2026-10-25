import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "library" / "tools"))
import build_site
import build_wishlist
import steam_meta


class RankingImportTests(unittest.TestCase):
    def test_shared_approval_contract_matches_browser_expectations(self):
        fixture = json.loads((Path(__file__).resolve().parents[1] / "ranking/fixtures/contracts.json").read_text())
        for case in fixture["approvalCases"]:
            actual = steam_meta.pick_score(case["pct"], case["count"])
            if case["expected"] is None:
                self.assertIsNone(actual)
            else:
                self.assertAlmostEqual(actual, case["expected"], places=8)

    def test_csv_projection_retains_components_per_copy_and_stable_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            export = root / "library.csv"
            with export.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["Id", "Name", "Platforms", "Sources", "Critic Score", "Community Score", "User Score"])
                writer.writeheader()
                writer.writerows([
                    {"Id": "original", "Name": "Synthetic Adventure", "Platforms": "SNES", "Sources": "Local", "Critic Score": "70", "Community Score": "80", "User Score": "100"},
                    {"Id": "port", "Name": "Synthetic Adventure", "Platforms": "PC", "Sources": "Steam", "Critic Score": "95", "Community Score": "0", "User Score": ""},
                ])
            # Never open actual metadata caches or personal artwork in tests.
            with patch.multiple(build_site.steam_meta, load_igdb_genres=lambda: {}, load_name_map=lambda: {}, load_details_cache=lambda: {}, load_wikidata_genres=lambda: {}):
                rows = build_site.read_rows(export, {}, root / "covers", root / "backgrounds", root / "files", root)
                again = build_site.read_rows(export, {}, root / "covers", root / "backgrounds", root / "files", root)
            games = build_site.group_titles(rows)
            self.assertEqual(len(games), 2)
            game = {"copies": [copy for g in games for copy in g["copies"]]}
            self.assertEqual(len(game["copies"]), 2)
            self.assertEqual([c["criticScore"] for c in game["copies"]], [70, 95])
            self.assertEqual([c["userScore"] for c in game["copies"]], [100, None])
            self.assertEqual(game["copies"][1]["communityScore"], 0)
            self.assertEqual(rows[0]["scoreImport"], again[0]["scoreImport"])
            self.assertEqual(len(rows[0]["scoreImport"]["checksum"]), 64)

    def test_external_ids_retain_copy_title_and_candidate_provenance(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            export = root / "library.csv"
            with export.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["Id", "Name", "Platforms", "Sources", "Steam App ID", "Steam Store URL"])
                writer.writeheader()
                writer.writerows([
                    {"Id": "lookup", "Name": "Same Name", "Platforms": "Windows", "Sources": "Steam"},
                    {"Id": "explicit", "Name": "Same Name", "Platforms": "Windows", "Sources": "Steam", "Steam App ID": "123"},
                    {"Id": "url", "Name": "URL Game", "Platforms": "Windows", "Sources": "Steam", "Steam Store URL": "https://store.steampowered.com/app/456/Game/"},
                    {"Id": "bad", "Name": "Bad ID", "Platforms": "Windows", "Sources": "Steam", "Steam App ID": "1e3"},
                ])
            with patch.multiple(build_site.steam_meta, load_igdb_genres=lambda: {}, load_name_map=lambda: {"Same Name": "999", "Bad ID": "789"}, load_details_cache=lambda: {}, load_wikidata_genres=lambda: {}):
                rows = build_site.read_rows(export, {}, root / "covers", root / "backgrounds", root / "files", root)
            self.assertEqual([r["steamAppId"] for r in rows], ["999", "123", "456", ""])
            self.assertEqual([r["steamAppIdProvenance"]["origin"] for r in rows], ["title-search", "csv-steam-id", "csv-steam-url", "invalid-csv-steam-id"])
            games = build_site.group_titles(rows)
            self.assertEqual(len(games), 4)
            copies = [c for game in games for c in game["copies"]]
            self.assertEqual([c["steamAppId"] for c in copies[:2]], ["999", "123"])
            self.assertTrue(all(c["steamAppIdProvenance"]["trust"] == "candidate" for c in copies[:2]))
            self.assertEqual(copies[0]["name"], "Same Name")

    def test_wishlist_missing_scores_are_not_zero_or_included_in_mean(self):
        rows = build_wishlist.build_entries([
            {"title": "Missing", "gameid": ["steam", "app/1"]},
            {"title": "Actual zero", "gameid": ["steam", "app/2"], "reviews": {"count": 10, "percPositive": 0}},
            {"title": "Rated", "gameid": ["steam", "app/3"], "reviews": {"count": "100", "percPositive": "90.5"}},
        ], {}, {})
        self.assertIsNone(rows[0]["reviewPct"])
        self.assertIsNone(rows[0]["reviewCount"])
        self.assertIsNone(rows[0]["pickScore"])
        self.assertEqual(rows[1]["reviewPct"], 0)
        self.assertEqual(rows[2]["reviewPct"], 90.5)
        self.assertEqual(build_wishlist.build_stats(rows)["ratedCount"], 2)
        self.assertEqual(build_wishlist.build_stats(rows)["avgReviewPct"], 45)

    def test_import_never_fabricates_counts_dates_or_scope(self):
        result = build_wishlist.review_snapshot({"count": 100, "percPositive": 91})
        self.assertIsNone(result["positive"])
        self.assertIsNone(result["observedAt"])
        self.assertIsNone(result["queryScope"])
        for invalid in [{"count": "broken"}, {"count": -1}, {"count": True}, {"count": 0, "percPositive": 90}, {"count": 100, "percPositive": 101}, {"count": 100, "percPositive": "NaN"}, {"count": 10, "positive": 10, "negative": 1, "percPositive": 99}]:
            self.assertIsNone(build_wishlist.build_entries([{"title":"Invalid", "reviews":invalid}], {}, {})[0]["pickScore"])

    def test_exact_count_export_reimport_preserves_population_and_observation_time(self):
        reviews = {"count": 3, "positive": 2, "negative": 1, "percPositive": 99, "observedAt": "2026-09-15T12:00:00Z", "queryScope": {"language":"all"}}
        snapshot = build_wishlist.review_snapshot(reviews)
        restored = build_wishlist.review_snapshot({"count": snapshot["total"], "percPositive": snapshot["percentage"], "positive":snapshot["positive"], "negative":snapshot["negative"], "observedAt":snapshot["observedAt"], "queryScope":snapshot["queryScope"]})
        self.assertAlmostEqual(restored["percentage"], 200/3)
        for field in ["positive", "negative", "total", "observedAt", "queryScope"]:
            self.assertEqual(snapshot[field], restored[field])


if __name__ == "__main__":
    unittest.main()
