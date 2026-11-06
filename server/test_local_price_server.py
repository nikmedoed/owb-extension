import os
os.environ["PRICE_SERVER_DB"] = ":memory:"
import unittest
import local_price_server as server


class BulkTransactionTests(unittest.TestCase):
    def setUp(self):
        server.init_db()
        server.DB_CONN.execute("DELETE FROM price_intervals")
        server.DB_CONN.commit()
        self.statements = []
        server.DB_CONN.set_trace_callback(self.statements.append)

    def tearDown(self):
        server.DB_CONN.set_trace_callback(None)

    def interval(self, first, last, price=100):
        return server.PriceInterval("ozon:1", "1", price, "RUB", first, last)

    def test_bulk_merges_and_commits_once(self):
        result = server.STORE.upsert_many([
            self.interval(10, 20), self.interval(30, 40), self.interval(20, 30),
        ])
        self.assertEqual(result["accepted"], 3)
        rows = server.DB_CONN.execute("SELECT first_ts, last_ts FROM price_intervals").fetchall()
        self.assertEqual([tuple(row) for row in rows], [(10, 40)])
        self.assertEqual(self.statements.count("COMMIT"), 1)

    def test_bulk_rolls_back_on_failure(self):
        def items():
            yield self.interval(10, 20)
            raise ValueError("invalid next item")
        with self.assertRaises(ValueError):
            server.STORE.upsert_many(items())
        self.assertEqual(server.DB_CONN.execute("SELECT COUNT(*) FROM price_intervals").fetchone()[0], 0)
        self.assertIn("ROLLBACK", self.statements)
        self.assertEqual(server.STORE.upsert_interval(self.interval(50, 60))["status"], "inserted")


if __name__ == "__main__":
    unittest.main()
