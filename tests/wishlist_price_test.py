import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "library" / "tools"))
import build_wishlist
import steam_meta
import steam_enrich


class WishlistPriceTests(unittest.TestCase):
    def test_cached_observation_is_preserved_and_unknown_dates_stay_unknown(self):
        payload = {"price_overview": {"final": 1499, "currency": "GBP"}, "_fetchedAt": "2026-09-14T12:00:00Z"}
        result = build_wishlist.price_snapshot({}, payload)
        self.assertEqual(result["observedAt"], "2026-09-14T12:00:00.000Z")
        self.assertEqual(result["amountMinor"], 1499)
        del payload["_fetchedAt"]
        self.assertIsNone(build_wishlist.price_snapshot({}, payload)["observedAt"])
        self.assertIsNone(build_wishlist.price_snapshot({"price": "£14.99"}, {}))
        self.assertIsNone(build_wishlist.price_snapshot({"price_snapshot": "invalid"}, {}))

    def test_foreign_prices_never_become_pounds_and_zero_is_a_real_price(self):
        payload = {"price_overview": {"final": 0, "currency": "USD"}}
        self.assertIsNone(build_wishlist.price_pence("$0.00", payload))
        self.assertEqual(build_wishlist.price_snapshot({}, payload)["amountMinor"], 0)
        self.assertEqual(build_wishlist.price_pence("£1.99", {}), 199)
        self.assertIsNone(build_wishlist.price_pence("1.99", {}))

    def test_cache_reader_retains_timestamp_and_trimmed_export_preserves_price_provenance(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.jsonl"
            path.write_text(json.dumps({"appid": "101", "ok": True, "fetchedAt": "2026-09-14T12:00:00Z", "data": {"name": "Fixture"}}))
            self.assertEqual(steam_meta.load_details_cache(path)["101"]["_fetchedAt"], "2026-09-14T12:00:00Z")
        old = {"amountMinor": 1500, "currency": "EUR", "observedAt": "2026-01-01T00:00:00.000Z"}
        self.assertEqual(build_wishlist.price_snapshot({"price_snapshot": old}, {})["observedAt"], old["observedAt"])

    def test_successful_fetch_stamps_the_observation_without_calling_the_network(self):
        original = steam_enrich.fetch_json
        steam_enrich.fetch_json = lambda url: {"101": {"success": True, "data": {"name": "Fixture", "price_overview": {"final": 100, "currency": "GBP"}}}}
        try:
            record = steam_enrich.fetch_app("101", "gb", "english")
            self.assertTrue(record["fetchedAt"].endswith("Z"))
            self.assertEqual(record["data"]["price_overview"]["currency"], "GBP")
        finally:
            steam_enrich.fetch_json = original


if __name__ == "__main__":
    unittest.main()
