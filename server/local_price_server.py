"""
Local price history API server with interval storage.

Data model (price_intervals):
- pidKey
- pid
- price
- currency
- firstTs
- lastTs
- updatedTs

The server supports two flows:
1. Observation mode (`POST /api/price`): extend last interval if price/currency stayed the same.
2. Sync mode (`POST /api/intervals/bulk`): upsert intervals from clients and merge overlaps.
3. Pull mode (`GET /api/changes`): incremental feed with composite cursor (`since`, `sinceId`).

Run:
    python local_price_server.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import time
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

DB_PATH = Path(os.environ.get("PRICE_SERVER_DB", str(Path(__file__).with_name("price_history.sqlite"))))
HOST = os.environ.get("PRICE_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("PRICE_SERVER_PORT", "8765"))
MAX_BULK_INTERVALS = int(os.environ.get("PRICE_SERVER_MAX_BULK", "2000"))

DB_LOCK = threading.Lock()
DB_CONN = sqlite3.connect(DB_PATH, check_same_thread=False)
DB_CONN.row_factory = sqlite3.Row


def now_ms() -> int:
    return int(time() * 1000)


def normalize_currency(value: Any) -> str:
    return str(value or "").strip()


def init_db() -> None:
    with DB_LOCK:
        cur = DB_CONN.cursor()
        cur.execute("PRAGMA journal_mode=WAL;")
        cur.execute("PRAGMA synchronous=NORMAL;")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS price_intervals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pid_key TEXT NOT NULL,
                pid TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT '',
                first_ts INTEGER NOT NULL,
                last_ts INTEGER NOT NULL,
                created_ts INTEGER NOT NULL,
                updated_ts INTEGER NOT NULL
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_intervals_pid_key_first ON price_intervals(pid_key, first_ts);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_intervals_pid_key_last ON price_intervals(pid_key, last_ts);")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_intervals_pid_key_price_currency ON price_intervals(pid_key, price, currency);"
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_intervals_updated_ts ON price_intervals(updated_ts);")
        DB_CONN.commit()
        migrate_legacy_snapshots(cur)
        DB_CONN.commit()


def table_exists(cur: sqlite3.Cursor, name: str) -> bool:
    cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,))
    return cur.fetchone() is not None


def migrate_legacy_snapshots(cur: sqlite3.Cursor) -> None:
    if not table_exists(cur, "price_history"):
        return
    cur.execute("SELECT COUNT(1) AS c FROM price_intervals")
    existing = int(cur.fetchone()["c"])
    if existing > 0:
        return

    # Legacy schema stores snapshots by ts. We compress them into intervals.
    try:
        cur.execute(
            """
            SELECT pidKey AS pid_key, COALESCE(pid, '') AS pid, ts, price, COALESCE(currency, '') AS currency
            FROM price_history
            ORDER BY pidKey ASC, ts ASC
            """
        )
    except sqlite3.Error:
        return

    rows = cur.fetchall()
    if not rows:
        return

    packed: List[Tuple[str, str, float, str, int, int]] = []
    active: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        pid_key = row["pid_key"]
        pid = row["pid"] or ""
        ts = int(row["ts"])
        price = float(row["price"])
        currency = row["currency"] or ""
        prev = active.get(pid_key)
        if prev and prev["price"] == price and prev["currency"] == currency:
            prev["last_ts"] = max(prev["last_ts"], ts)
            if pid and not prev["pid"]:
                prev["pid"] = pid
        else:
            if prev:
                packed.append(
                    (
                        pid_key,
                        prev["pid"],
                        prev["price"],
                        prev["currency"],
                        prev["first_ts"],
                        prev["last_ts"],
                    )
                )
            active[pid_key] = {
                "pid": pid,
                "price": price,
                "currency": currency,
                "first_ts": ts,
                "last_ts": ts,
            }

    for pid_key, prev in active.items():
        packed.append((pid_key, prev["pid"], prev["price"], prev["currency"], prev["first_ts"], prev["last_ts"]))

    created = now_ms()
    cur.executemany(
        """
        INSERT INTO price_intervals (
            pid_key, pid, price, currency, first_ts, last_ts, created_ts, updated_ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(pid_key, pid, price, currency, first_ts, last_ts, created, created) for pid_key, pid, price, currency, first_ts, last_ts in packed],
    )
    print(f"Migrated {len(packed)} intervals from legacy snapshots table price_history.")


def with_cors(handler: BaseHTTPRequestHandler, status: int = 200) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()


def write_json(handler: BaseHTTPRequestHandler, payload: Dict[str, Any], status: int = 200) -> None:
    with_cors(handler, status)
    handler.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def read_json(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    data = handler.rfile.read(length) if length else b"{}"
    if not data:
        return {}
    try:
        return json.loads(data.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


@dataclass
class PriceInterval:
    pid_key: str
    pid: str
    price: float
    currency: str
    first_ts: int
    last_ts: int
    updated_ts: int = 0

    @classmethod
    def from_payload(cls, data: Dict[str, Any], default_ts: Optional[int] = None) -> "PriceInterval":
        pid_key = str(data.get("pidKey") or "").strip()
        if not pid_key:
            raise ValueError("pidKey is required")
        pid = str(data.get("pid") or "").strip()
        currency = str(data.get("currency") or "")
        price = float(data.get("price"))

        if "firstTs" in data or "lastTs" in data:
            first_ts = int(data.get("firstTs"))
            last_ts = int(data.get("lastTs"))
        else:
            ts = int(data.get("ts") or default_ts or now_ms())
            first_ts = ts
            last_ts = ts

        if first_ts > last_ts:
            first_ts, last_ts = last_ts, first_ts

        updated_ts = int(data.get("updatedTs") or now_ms())
        return cls(
            pid_key=pid_key,
            pid=pid,
            price=price,
            currency=currency,
            first_ts=first_ts,
            last_ts=last_ts,
            updated_ts=updated_ts,
        )


class PriceStore:
    def __init__(self, conn: sqlite3.Connection, lock: threading.Lock):
        self.conn = conn
        self.lock = lock

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": int(row["id"]),
            "pidKey": row["pid_key"],
            "pid": row["pid"] or "",
            "price": float(row["price"]),
            "currency": row["currency"] or "",
            "firstTs": int(row["first_ts"]),
            "lastTs": int(row["last_ts"]),
            "updatedTs": int(row["updated_ts"]),
        }

    def _get_by_id(self, cur: sqlite3.Cursor, row_id: int) -> sqlite3.Row:
        cur.execute(
            """
            SELECT id, pid_key, pid, price, currency, first_ts, last_ts, updated_ts
            FROM price_intervals
            WHERE id=?
            """,
            (row_id,),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError("Interval row was not found after write")
        return row

    @staticmethod
    def _pick_latest_row(rows: Iterable[sqlite3.Row]) -> Optional[sqlite3.Row]:
        rows_list = list(rows)
        if not rows_list:
            return None
        return max(
            rows_list,
            key=lambda row: (int(row["last_ts"]), int(row["first_ts"]), int(row["id"])),
        )

    @staticmethod
    def _pick_min_row(rows: Iterable[sqlite3.Row]) -> Optional[sqlite3.Row]:
        rows_list = list(rows)
        if not rows_list:
            return None
        return min(
            rows_list,
            key=lambda row: (float(row["price"]), int(row["first_ts"]), -int(row["last_ts"]), int(row["id"])),
        )

    def _select_rows_for_usage(
        self,
        rows: Iterable[sqlite3.Row],
        preferred_currency: str = "",
    ) -> List[sqlite3.Row]:
        rows_list = list(rows)
        if not rows_list:
            return []
        clean_preferred = normalize_currency(preferred_currency)
        if clean_preferred:
            return [row for row in rows_list if normalize_currency(row["currency"]) == clean_preferred]
        latest = self._pick_latest_row(rows_list)
        latest_currency = normalize_currency(latest["currency"]) if latest else ""
        if latest_currency:
            scoped = [row for row in rows_list if normalize_currency(row["currency"]) == latest_currency]
            if scoped:
                return scoped
        return rows_list

    def history(self, pid_key: str) -> List[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT id, pid_key, pid, price, currency, first_ts, last_ts, updated_ts
                FROM price_intervals
                WHERE pid_key=?
                ORDER BY first_ts ASC, last_ts ASC, id ASC
                """,
                (pid_key,),
            )
            return [self._row_to_dict(row) for row in cur.fetchall()]

    def changes(self, since_ts: int, since_id: int, limit: int) -> List[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT id, pid_key, pid, price, currency, first_ts, last_ts, updated_ts
                FROM price_intervals
                WHERE (updated_ts > ?)
                   OR (updated_ts = ? AND id > ?)
                ORDER BY updated_ts ASC, id ASC
                LIMIT ?
                """,
                (since_ts, since_ts, since_id, limit),
            )
            return [self._row_to_dict(row) for row in cur.fetchall()]

    def record_observation(self, pid_key: str, pid: str, price: float, currency: str, ts: int) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT id, pid_key, pid, price, currency, first_ts, last_ts, updated_ts
                FROM price_intervals
                WHERE pid_key=?
                ORDER BY last_ts DESC, id DESC
                LIMIT 1
                """,
                (pid_key,),
            )
            last = cur.fetchone()
            update_ts = now_ms()

            if (
                last
                and float(last["price"]) == price
                and (last["currency"] or "") == (currency or "")
            ):
                row_id = int(last["id"])
                next_last = max(int(last["last_ts"]), ts)
                next_first = min(int(last["first_ts"]), ts)
                next_pid = pid or (last["pid"] or "")
                cur.execute(
                    """
                    UPDATE price_intervals
                    SET pid=?, first_ts=?, last_ts=?, updated_ts=?
                    WHERE id=?
                    """,
                    (next_pid, next_first, next_last, update_ts, row_id),
                )
                self.conn.commit()
                return {"status": "extended", "interval": self._row_to_dict(self._get_by_id(cur, row_id))}

            cur.execute(
                """
                INSERT INTO price_intervals (
                    pid_key, pid, price, currency, first_ts, last_ts, created_ts, updated_ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid_key, pid, price, currency, ts, ts, update_ts, update_ts),
            )
            row_id = int(cur.lastrowid)
            self.conn.commit()
            return {"status": "inserted", "interval": self._row_to_dict(self._get_by_id(cur, row_id))}

    def _find_overlaps_same_price(
        self,
        cur: sqlite3.Cursor,
        pid_key: str,
        price: float,
        currency: str,
        first_ts: int,
        last_ts: int,
        skip_id: Optional[int] = None,
    ) -> List[sqlite3.Row]:
        params: List[Any] = [pid_key, price, currency, first_ts - 1, last_ts + 1]
        where_skip = ""
        if skip_id is not None:
            where_skip = "AND id != ?"
            params.append(skip_id)
        cur.execute(
            f"""
            SELECT id, pid_key, pid, price, currency, first_ts, last_ts, updated_ts
            FROM price_intervals
            WHERE pid_key=?
              AND price=?
              AND currency=?
              AND last_ts >= ?
              AND first_ts <= ?
              {where_skip}
            ORDER BY first_ts ASC, id ASC
            """,
            tuple(params),
        )
        return cur.fetchall()

    def upsert_interval(self, interval: PriceInterval) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.cursor()
            update_ts = max(interval.updated_ts or 0, now_ms())
            overlaps = self._find_overlaps_same_price(
                cur,
                interval.pid_key,
                interval.price,
                interval.currency,
                interval.first_ts,
                interval.last_ts,
            )
            status = "inserted"

            if overlaps:
                keep = overlaps[0]
                keep_id = int(keep["id"])
                merged_first = min([interval.first_ts] + [int(r["first_ts"]) for r in overlaps])
                merged_last = max([interval.last_ts] + [int(r["last_ts"]) for r in overlaps])
                merged_pid = interval.pid or (keep["pid"] or "")
                cur.execute(
                    """
                    UPDATE price_intervals
                    SET pid=?, first_ts=?, last_ts=?, updated_ts=?
                    WHERE id=?
                    """,
                    (merged_pid, merged_first, merged_last, update_ts, keep_id),
                )
                remove_ids = [int(r["id"]) for r in overlaps[1:]]
                if remove_ids:
                    cur.execute(
                        f"DELETE FROM price_intervals WHERE id IN ({','.join('?' for _ in remove_ids)})",
                        tuple(remove_ids),
                    )
                status = "merged" if remove_ids or merged_first != int(keep["first_ts"]) or merged_last != int(keep["last_ts"]) else "updated"
                row_id = keep_id
            else:
                cur.execute(
                    """
                    INSERT INTO price_intervals (
                        pid_key, pid, price, currency, first_ts, last_ts, created_ts, updated_ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        interval.pid_key,
                        interval.pid,
                        interval.price,
                        interval.currency,
                        interval.first_ts,
                        interval.last_ts,
                        update_ts,
                        update_ts,
                    ),
                )
                row_id = int(cur.lastrowid)

            # Chain-merge any newly touched intervals after widening.
            while True:
                base = self._get_by_id(cur, row_id)
                chained = self._find_overlaps_same_price(
                    cur,
                    interval.pid_key,
                    interval.price,
                    interval.currency,
                    int(base["first_ts"]),
                    int(base["last_ts"]),
                    skip_id=row_id,
                )
                if not chained:
                    break
                next_first = min([int(base["first_ts"])] + [int(r["first_ts"]) for r in chained])
                next_last = max([int(base["last_ts"])] + [int(r["last_ts"]) for r in chained])
                next_pid = interval.pid or (base["pid"] or "")
                cur.execute(
                    """
                    UPDATE price_intervals
                    SET pid=?, first_ts=?, last_ts=?, updated_ts=?
                    WHERE id=?
                    """,
                    (next_pid, next_first, next_last, update_ts, row_id),
                )
                del_ids = [int(r["id"]) for r in chained]
                cur.execute(
                    f"DELETE FROM price_intervals WHERE id IN ({','.join('?' for _ in del_ids)})",
                    tuple(del_ids),
                )
                status = "merged"

            self.conn.commit()
            return {"status": status, "interval": self._row_to_dict(self._get_by_id(cur, row_id))}

    def upsert_many(self, items: Iterable[PriceInterval]) -> Dict[str, Any]:
        inserted = 0
        merged = 0
        updated = 0
        accepted = 0
        out: List[Dict[str, Any]] = []
        for interval in items:
            result = self.upsert_interval(interval)
            accepted += 1
            status = result["status"]
            if status == "inserted":
                inserted += 1
            elif status == "merged":
                merged += 1
            else:
                updated += 1
            out.append(result["interval"])
        return {
            "accepted": accepted,
            "inserted": inserted,
            "merged": merged,
            "updated": updated,
            "intervals": out,
        }

    def min_batch(
        self,
        pid_keys: Iterable[str],
        preferred_currencies: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Dict[str, Any]]:
        clean_keys = [str(k or "").strip() for k in pid_keys]
        clean_keys = [k for k in clean_keys if k]
        if not clean_keys:
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        preferred_map = preferred_currencies if isinstance(preferred_currencies, dict) else {}
        with self.lock:
            cur = self.conn.cursor()
            for pid_key in clean_keys:
                cur.execute(
                    """
                    SELECT id, pid_key, pid, price, currency, first_ts, last_ts, updated_ts
                    FROM price_intervals
                    WHERE pid_key=?
                    ORDER BY first_ts ASC, last_ts ASC, id ASC
                    """,
                    (pid_key,),
                )
                rows = cur.fetchall()
                scoped_rows = self._select_rows_for_usage(rows, preferred_map.get(pid_key, ""))
                row = self._pick_min_row(scoped_rows)
                if not row:
                    continue
                out[pid_key] = {
                    "pidKey": row["pid_key"],
                    "pid": row["pid"] or "",
                    "price": float(row["price"]),
                    "currency": row["currency"] or "",
                    "firstTs": int(row["first_ts"]),
                    "lastTs": int(row["last_ts"]),
                    "updatedTs": int(row["updated_ts"]),
                }
        return out


STORE = PriceStore(DB_CONN, DB_LOCK)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:
        with_cors(self)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/ping":
            write_json(self, {"status": "ok", "serverTime": now_ms()})
            return

        if parsed.path == "/api/history":
            pid_key = parse_qs(parsed.query).get("pidKey", [""])[0].strip()
            if not pid_key:
                write_json(self, {"error": "pidKey is required"}, status=400)
                return
            history = STORE.history(pid_key)
            write_json(self, {"status": "ok", "pidKey": pid_key, "history": history, "serverTime": now_ms()})
            return

        if parsed.path == "/api/changes":
            qs = parse_qs(parsed.query)
            try:
                since = int(qs.get("since", ["0"])[0])
            except ValueError:
                since = 0
            try:
                since_id = int(qs.get("sinceId", ["0"])[0])
            except ValueError:
                since_id = 0
            try:
                limit = int(qs.get("limit", ["500"])[0])
            except ValueError:
                limit = 500
            since_id = max(0, since_id)
            limit = max(1, min(limit, 5000))
            changes = STORE.changes(since, since_id, limit)
            next_since = since
            next_since_id = since_id
            if changes:
                tail = changes[-1]
                next_since = int(tail["updatedTs"])
                next_since_id = int(tail["id"])
            write_json(
                self,
                {
                    "status": "ok",
                    "since": since,
                    "sinceId": since_id,
                    "nextSince": next_since,
                    "nextSinceId": next_since_id,
                    "changes": changes,
                    "serverTime": now_ms(),
                },
            )
            return

        write_json(self, {"error": "not found"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        payload = read_json(self)

        if parsed.path == "/api/price":
            pid_key = str(payload.get("pidKey") or "").strip()
            pid = str(payload.get("pid") or "").strip()
            price = payload.get("price")
            currency = str(payload.get("currency") or "")
            ts = int(payload.get("ts") or now_ms())

            if not pid_key or price is None:
                write_json(self, {"error": "pidKey and price are required"}, status=400)
                return

            try:
                result = STORE.record_observation(
                    pid_key=pid_key,
                    pid=pid,
                    price=float(price),
                    currency=currency,
                    ts=ts,
                )
                write_json(self, {"status": "ok", **result, "serverTime": now_ms()})
            except (TypeError, ValueError) as exc:
                write_json(self, {"error": f"bad payload: {exc}"}, status=400)
            except Exception as exc:
                write_json(self, {"error": str(exc)}, status=500)
            return

        if parsed.path == "/api/intervals/bulk":
            intervals = payload.get("intervals")
            if not isinstance(intervals, list):
                write_json(self, {"error": "intervals array is required"}, status=400)
                return
            if len(intervals) > MAX_BULK_INTERVALS:
                write_json(self, {"error": f"too many intervals, max {MAX_BULK_INTERVALS}"}, status=400)
                return
            normalized: List[PriceInterval] = []
            try:
                for raw in intervals:
                    if not isinstance(raw, dict):
                        raise ValueError("each interval must be an object")
                    normalized.append(PriceInterval.from_payload(raw))
            except (TypeError, ValueError) as exc:
                write_json(self, {"error": f"bad interval payload: {exc}"}, status=400)
                return

            result = STORE.upsert_many(normalized)
            write_json(self, {"status": "ok", **result, "serverTime": now_ms()})
            return

        if parsed.path == "/api/min-batch":
            pid_keys = payload.get("pidKeys")
            preferred_currencies = payload.get("preferredCurrencies")
            if not isinstance(pid_keys, list):
                write_json(self, {"error": "pidKeys array is required"}, status=400)
                return
            if len(pid_keys) > 3000:
                write_json(self, {"error": "too many pidKeys, max 3000"}, status=400)
                return
            if preferred_currencies is not None and not isinstance(preferred_currencies, dict):
                write_json(self, {"error": "preferredCurrencies must be an object"}, status=400)
                return
            mins = STORE.min_batch(pid_keys, preferred_currencies)
            write_json(self, {"status": "ok", "count": len(mins), "mins": mins, "serverTime": now_ms()})
            return

        write_json(self, {"error": "not found"}, status=404)


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Local price server listening on http://{HOST}:{PORT} (DB: {DB_PATH})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
