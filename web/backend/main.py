from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Reuse existing project modules (Deribit/GEX/news helpers) from ../.. /src
# Add project root to sys.path at runtime.
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # .../Sistema_Cripto
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.deribit_api import DeribitPublicClient  # noqa
from src.testdata import gen_ohlc  # noqa


APP_NAME = "Cripto Desk Web"

# -------------------- Simple auth --------------------
# NOTE: Diego asked for Myfriend/Cripto. We keep them configurable via env.
AUTH_USER = os.environ.get("CRYPT_USER", "Myfriend")
AUTH_PASS = os.environ.get("CRYPT_PASS", "Cripto")
AUTH_SECRET = os.environ.get("CRYPT_SECRET", "change-me")
TOKEN_TTL_SEC = int(os.environ.get("CRYPT_TOKEN_TTL", "86400"))


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("utf-8").rstrip("=")


def _b64u_dec(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("utf-8"))


def make_token(username: str) -> str:
    payload = {"u": username, "iat": int(time.time())}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(AUTH_SECRET.encode("utf-8"), raw, hashlib.sha256).digest()
    return _b64u(raw) + "." + _b64u(sig)


def verify_token(token: str) -> Optional[dict]:
    try:
        a, b = (token or "").split(".", 1)
        raw = _b64u_dec(a)
        sig = _b64u_dec(b)
        exp_sig = hmac.new(AUTH_SECRET.encode("utf-8"), raw, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, exp_sig):
            return None
        payload = json.loads(raw.decode("utf-8"))
        iat = int(payload.get("iat") or 0)
        if int(time.time()) - iat > TOKEN_TTL_SEC:
            return None
        return payload
    except Exception:
        return None


def get_user(req: Request) -> dict:
    # Expect: Authorization: Bearer <token>
    auth = req.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        tok = auth.split(" ", 1)[1].strip()
        payload = verify_token(tok)
        if payload:
            return payload
    raise HTTPException(status_code=401, detail="unauthorized")


app = FastAPI(title=APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "name": APP_NAME, "ts": int(time.time())}


@app.post("/auth/login")
async def login(req: Request):
    body = await req.json()
    user = str(body.get("username") or "")
    pw = str(body.get("password") or "")
    if user == AUTH_USER and pw == AUTH_PASS:
        tok = make_token(user)
        return {"ok": True, "token": tok, "user": {"username": user}}
    raise HTTPException(status_code=401, detail="invalid credentials")


@app.get("/api/desk/ohlc")
def desk_ohlc(
    instrument: str = "BTC-PERPETUAL",
    tf: str = "60",
    candles: int = 900,
    user: dict = Depends(get_user),
):
    """Return OHLC for desk instrument.

    For now uses Deribit TradingView chart data for BTC/ETH perpetual.
    """
    candles = max(120, min(3000, int(candles)))

    client = DeribitPublicClient(timeout=7.0)

    # compute span from candles+tf
    tf_sec = 60
    if tf == "1":
        tf_sec = 60
    elif tf == "5":
        tf_sec = 5 * 60
    elif tf == "15":
        tf_sec = 15 * 60
    elif tf == "60":
        tf_sec = 60 * 60
    elif tf == "240":
        tf_sec = 4 * 60 * 60
    else:
        tf = "1D"
        tf_sec = 24 * 60 * 60

    now_ms = int(time.time() * 1000)
    start_ms = now_ms - int(candles * tf_sec * 1000)

    chart, _ = client.get_tradingview_chart_data(instrument, tf, start_ms, now_ms)

    t = chart.get("ticks") or chart.get("t") or []
    o = chart.get("open") or chart.get("o") or []
    h = chart.get("high") or chart.get("h") or []
    l = chart.get("low") or chart.get("l") or []
    c = chart.get("close") or chart.get("c") or []
    v = chart.get("volume") or chart.get("v") or []

    # normalize ms->sec
    try:
        if t and float(t[-1]) > 1e11:
            t = [float(x) / 1000.0 for x in t]
    except Exception:
        pass

    return {
        "ok": True,
        "instrument": instrument,
        "tf": tf,
        "candles": candles,
        "ohlc": {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v},
        "user": user.get("u"),
    }


@app.get("/api/test/ohlc")
def test_ohlc(tf: str = "60", candles: int = 900, user: dict = Depends(get_user)):
    """Synthetic OHLC for UI development."""
    candles = max(120, min(3000, int(candles)))
    step = 60 if tf in ("1", "5", "15") else (60 * 60 if tf in ("60",) else (4 * 60 * 60 if tf in ("240",) else 24 * 60 * 60))
    ohlc = gen_ohlc(n=candles, start_price=70000.0, step_sec=step)
    return {"ok": True, "tf": tf, "candles": candles, "ohlc": ohlc}


@app.exception_handler(HTTPException)
async def http_exc(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": exc.detail})
