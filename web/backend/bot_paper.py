from __future__ import annotations

import time
import json
import os
from typing import Any, Optional


class PaperStore:
    def __init__(self, path: str):
        self.path = path
        self.data: dict[str, Any] = {"open": [], "history": [], "ts": int(time.time() * 1000)}

    def load(self):
        try:
            if not os.path.exists(self.path):
                return
            with open(self.path, "r", encoding="utf-8") as f:
                obj = json.load(f) or {}
            if isinstance(obj, dict):
                self.data["open"] = list(obj.get("open") or [])
                self.data["history"] = list(obj.get("history") or [])
        except Exception:
            pass

    def save(self):
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump({"open": self.data.get("open") or [], "history": self.data.get("history") or [], "ts": int(time.time() * 1000)}, f)
        except Exception:
            pass

    def open_list(self):
        return list(self.data.get("open") or [])

    def history_list(self):
        return list(self.data.get("history") or [])

    def set_open(self, rows: list[dict]):
        self.data["open"] = list(rows or [])
        self.save()

    def add_history(self, row: dict):
        self.data.setdefault("history", []).insert(0, row)
        # cap
        self.data["history"] = (self.data.get("history") or [])[:2000]
        self.save()

    def add_open(self, row: dict):
        self.data.setdefault("open", []).insert(0, row)
        self.save()

    def close_open(self, trade_id: str, close_row: dict):
        opens = [x for x in (self.data.get("open") or []) if str(x.get("id")) != str(trade_id)]
        self.data["open"] = opens
        self.add_history(close_row)
        self.save()


class BotState:
    def __init__(self):
        self.enabled = False
        self.auto_entry = False
        self.currency = "BTC"
        self.expiries: list[str] = []
        self.strike_range_pct = 8.0
        self.walls_n = 18
        self.tp_move_pct = 1.5
        self.sl_pnl_pct = -60.0
        self.qty = 0.0  # 0 = auto min lot
        self.spot_src = "index"  # index|last
        self.cooldown_sec = 15

        self.last_spot: Optional[float] = None
        self.last_action_ms: int = 0

    def can_act(self) -> bool:
        now = int(time.time() * 1000)
        return (now - self.last_action_ms) >= int(self.cooldown_sec * 1000)

    def mark_act(self):
        self.last_action_ms = int(time.time() * 1000)
