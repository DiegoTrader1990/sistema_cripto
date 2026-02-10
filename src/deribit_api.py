from __future__ import annotations
import time
import requests
from typing import Dict, Any, Tuple, List

BASE_URL = "https://www.deribit.com/api/v2"

class DeribitPublicClient:
    def __init__(self, timeout: float = 6.0):
        self.timeout = timeout
        self.sess = requests.Session()
        self.sess.headers.update({"User-Agent":"gex-desk-pro/7.7"})

    def _get(self, path: str, params: Dict[str, Any]):
        url = BASE_URL + path
        t0 = time.time()
        r = self.sess.get(url, params=params, timeout=self.timeout)
        lat = (time.time() - t0) * 1000.0
        r.raise_for_status()
        data = r.json()
        if data.get("error"):
            raise RuntimeError(str(data["error"]))
        return data.get("result"), lat

    def get_ticker(self, instrument_name: str) -> Tuple[Dict[str, Any], float]:
        res, lat = self._get("/public/ticker", {"instrument_name": instrument_name})
        return (res or {}), lat

    def get_instruments(self, currency: str = "BTC", kind: str = "option", expired: bool = False):
        res, lat = self._get("/public/get_instruments", {"currency": currency, "kind": kind, "expired": str(expired).lower()})
        return (res or []), lat

    def get_tradingview_chart_data(self, instrument_name: str, resolution: str, start_ts_ms: int, end_ts_ms: int):
        res, lat = self._get("/public/get_tradingview_chart_data", {
            "instrument_name": instrument_name,
            "resolution": resolution,
            "start_timestamp": start_ts_ms,
            "end_timestamp": end_ts_ms,
        })
        return (res or {}), lat
