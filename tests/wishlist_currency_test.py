import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "library" / "tools"))
import build_wishlist


class CurrencyTests(unittest.TestCase):
    def test_export_prices_parse_in_their_own_currency(self):
        self.assertEqual(build_wishlist.parse_price_text("£49.99"), (4999, "GBP"))
        self.assertEqual(build_wishlist.parse_price_text("16,75€"), (1675, "EUR"))
        self.assertEqual(build_wishlist.parse_price_text("1.299,00€"), (129900, "EUR"))
        self.assertEqual(build_wishlist.parse_price_text("3,9€"), (390, "EUR"))
        self.assertEqual(build_wishlist.parse_price_text("Free"), (None, None))

    def test_prices_are_kept_only_in_the_store_currency(self):
        store_eur = {"price_overview": {"final": 1999, "currency": "EUR"}}
        self.assertEqual(build_wishlist.price_pence("16,75€", store_eur, "EUR"), 1999)
        self.assertEqual(build_wishlist.price_pence("16,75€", {}, "EUR"), 1675)
        # A cached pound price is never shown as euros (or the other way round).
        self.assertEqual(build_wishlist.price_pence("16,75€", {"price_overview": {"final": 1499, "currency": "GBP"}}, "GBP"), 1499)
        self.assertIsNone(build_wishlist.price_pence("", {"price_overview": {"final": 1499, "currency": "GBP"}}, "EUR"))
        self.assertIsNone(build_wishlist.price_pence("£14.99", {}, "EUR"))
        self.assertEqual(build_wishlist.price_pence("", {"is_free": True}, "EUR"), 0)



class StoreSettingTests(unittest.TestCase):
    def test_price_fetcher_loads_and_reads_the_store_country(self):
        import tempfile, json
        import steam_enrich, steam_meta
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "store.json"
            path.write_text(json.dumps({"country": "de", "currency": "EUR"}))
            self.assertEqual(steam_meta.load_store(path), {"country": "de", "currency": "EUR"})
            path.write_text("{broken")
            self.assertEqual(steam_meta.load_store(path), {"country": "gb", "currency": "GBP"})
        self.assertTrue(callable(steam_enrich.parse_args))


if __name__ == "__main__":
    unittest.main()
