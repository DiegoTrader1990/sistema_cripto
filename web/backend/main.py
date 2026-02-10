from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, List, Optional

import requests

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
from src.gex import compute_gex_rows, aggregate_by_strike, gamma_flip, top_walls, regime_text  # noqa
from src.testdata import gen_ohlc  # noqa


APP_NAME = "Cripto Desk Web"

# -------------------- News (RSS) --------------------
NEWS_FEEDS = [
    ("Crypto", "Google: crypto", "https://news.google.com/rss/search?q=crypto+when:1d&hl=en-US&gl=US&ceid=US:en"),
    ("Crypto", "Google: bitcoin", "https://news.google.com/rss/search?q=bitcoin+when:1d&hl=en-US&gl=US&ceid=US:en"),
    ("Macro", "Google: fed", "https://news.google.com/rss/search?q=federal+reserve+when:1d&hl=en-US&gl=US&ceid=US:en"),
    ("Macro", "Google: CPI", "https://news.google.com/rss/search?q=CPI+inflation+when:7d&hl=en-US&gl=US&ceid=US:en"),
    ("Macro", "Google: risk off", "https://news.google.com/rss/search?q=risk-off+stocks+when:1d&hl=en-US&gl=US&ceid=US:en"),
]

ASSET_KEYWORDS = {
    "BTC": ["bitcoin", "btc", "etf", "miners"],
    "ETH": ["ethereum", "eth", "gas", "layer 2", "l2"],
    "SOL": ["solana", "sol"],
    "XRP": ["xrp", "ripple"],
    "BNB": ["binance", "bnb"],
    "DOGE": ["dogecoin", "doge"],
    "ADA": ["cardano", "ada"],
    "AVAX": ["avalanche", "avax"],
    "LINK": ["chainlink", "link"],
    "DOT": ["polkadot", "dot"],
    "MATIC": ["polygon", "matic", "pol"],
    "LTC": ["litecoin", "ltc"],
    "ARB": ["arbitrum", "arb"],
    "OP": ["optimism", "op"],
    "SUI": ["sui"],
    "APT": ["aptos", "apt"],
}


def _between(s: str, a: str, b: str) -> str:
    try:
        i = s.find(a)
        if i < 0:
            return ""
        j = s.find(b, i + len(a))
        if j < 0:
            return ""
        return s[i + len(a) : j]
    except Exception:
        return ""


def _tag_assets(title: str) -> tuple[str, int]:
    t = (title or "").lower()
    hits: list[str] = []
    score = 0
    for sym, kws in ASSET_KEYWORDS.items():
        for k in kws:
            if k in t:
                hits.append(sym)
                score += 10
                break
    macro = [
        "federal reserve",
        "fed",
        "cpi",
        "inflation",
        "rates",
        "treasury",
        "dollar",
        "risk off",
        "risk-on",
        "geopolit",
    ]
    for m in macro:
        if m in t:
            score += 6
            break
    if not hits:
        hits = ["BTC", "ETH"]
    return ",".join(sorted(set(hits))), int(score)


def fetch_rss_items(url: str, timeout: float = 8.0) -> list[dict]:
    """Best-effort RSS parse without extra deps."""
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent": "cripto-desk-web/0.1"})
        r.raise_for_status()
        xml = r.text
        items: list[dict] = []
        for chunk in xml.split("<item>")[1:]:
            title = _between(chunk, "<title>", "</title>").strip()
            link = _between(chunk, "<link>", "</link>").strip()
            src = _between(chunk, "<source>", "</source>").strip() or "RSS"
            assets, score = _tag_assets(title)
            items.append({"ts": time.time(), "source": src, "title": title, "link": link, "assets": assets, "score": score})
        return items[:60]
    except Exception:
        return []


# -------------------- Altcoins (Binance spot) --------------------
BINANCE_BASE = "https://api.binance.com"
BINANCE_BASE_FALLBACK = "https://data-api.binance.vision"  # sometimes api.binance.com is blocked
BINANCE_TF = {"1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "1D": "1d"}

BYBIT_BASE = "https://api.bybit.com"
BYBIT_TF = {"1": "1", "5": "5", "15": "15", "60": "60", "240": "240", "1D": "D"}

_BINANCE_SYMBOLS_CACHE: dict[str, Any] = {"ts": 0.0, "symbols": []}


def binance_usdt_symbols(force: bool = False) -> list[str]:
    try:
        if (not force) and _BINANCE_SYMBOLS_CACHE.get("symbols") and (time.time() - float(_BINANCE_SYMBOLS_CACHE.get("ts") or 0.0)) < 6 * 3600:
            return list(_BINANCE_SYMBOLS_CACHE["symbols"])
    except Exception:
        pass

    def _fetch_exchangeinfo(base: str):
        url = base + "/api/v3/exchangeInfo"
        r = requests.get(url, timeout=12)
        r.raise_for_status()
        return r.json() or {}

    try:
        data = _fetch_exchangeinfo(BINANCE_BASE)
    except Exception:
        data = _fetch_exchangeinfo(BINANCE_BASE_FALLBACK)
    out: list[str] = []
    for s in (data.get("symbols") or []):
        try:
            if (s.get("status") != "TRADING"):
                continue
            if (s.get("quoteAsset") or "").upper() != "USDT":
                continue
            sym = (s.get("symbol") or "").upper().strip()
            if not sym or not sym.endswith("USDT"):
                continue
            bad = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")
            if any(sym.endswith(x) for x in bad):
                continue
            out.append(sym)
        except Exception:
            continue

    out = sorted(set(out))
    _BINANCE_SYMBOLS_CACHE["symbols"] = out
    _BINANCE_SYMBOLS_CACHE["ts"] = time.time()
    return out


def binance_klines(symbol: str, tf: str, limit: int = 300) -> dict:
    interval = BINANCE_TF.get(tf, "1m")

    def _fetch(base: str):
        url = base + "/api/v3/klines"
        r = requests.get(url, params={"symbol": symbol, "interval": interval, "limit": limit}, timeout=10)
        r.raise_for_status()
        return r.json() or []

    try:
        rows = _fetch(BINANCE_BASE)
    except Exception:
        rows = _fetch(BINANCE_BASE_FALLBACK)

    t: list[float] = []
    o: list[float] = []
    h: list[float] = []
    l: list[float] = []
    c: list[float] = []
    v: list[float] = []

    for k in (rows or []):
        ts = float(int(k[0]) // 1000)
        t.append(ts)
        o.append(float(k[1]))
        h.append(float(k[2]))
        l.append(float(k[3]))
        c.append(float(k[4]))
        v.append(float(k[5]))

    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}

# -------------------- Simple auth --------------------
# NOTE: Diego asked for Myfriend/Cripto. We keep them configurable via env.
AUTH_USER = os.environ.get("CRYPT_USER", "Myfriend")
AUTH_PASS = os.environ.get("CRYPT_PASS", "Cripto")
AUTH_SECRET = os.environ.get("CRYPT_SECRET", "change-me")
TOKEN_TTL_SEC = int(os.environ.get("CRYPT_TOKEN_TTL", "86400"))

DERIBIT_BASE = "https://www.deribit.com/api/v2"

def deribit_get(path: str, params: dict):
    r = requests.get(DERIBIT_BASE + path, params=params, timeout=10, headers={"User-Agent": "cripto-desk-web/0.1"})
    r.raise_for_status()
    data = r.json() or {}
    if data.get("error"):
        raise RuntimeError(str(data.get("error")))
    return data.get("result")

def _expiry_str_from_ts_ms(ts_ms: int) -> str:
    # Deribit instruments give expiration_timestamp in ms
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(int(ts_ms) / 1000))
    except Exception:
        return ""


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

# -------------------- CORS --------------------
# For this demo SaaS, we accept cross-origin requests from anywhere.
# Auth is via Bearer token, so we do NOT need cookies/credentials.
# This avoids Render/Cloudflare+Vercel origin edge-cases.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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


# -------------------- Desk Options (Deribit) --------------------
@app.get("/api/desk/expiries")
def desk_expiries(currency: str = "BTC", user: dict = Depends(get_user)):
    currency = (currency or "BTC").upper().strip()
    inst = deribit_get("/public/get_instruments", {"currency": currency, "kind": "option", "expired": "false"}) or []
    expiries = sorted({ _expiry_str_from_ts_ms(int(x.get("expiration_timestamp") or 0)) for x in inst if x.get("expiration_timestamp") })
    expiries = [e for e in expiries if e]
    return {"ok": True, "currency": currency, "expiries": expiries}


@app.get("/api/desk/chain")
def desk_chain(currency: str = "BTC", expiry: str = "", user: dict = Depends(get_user)):
    """Return option chain rows + GEX aggregates for a given expiry."""
    currency = (currency or "BTC").upper().strip()
    inst = deribit_get("/public/get_instruments", {"currency": currency, "kind": "option", "expired": "false"}) or []

    # choose default expiry: nearest
    if not expiry:
        expiries = sorted({ _expiry_str_from_ts_ms(int(x.get("expiration_timestamp") or 0)) for x in inst if x.get("expiration_timestamp") })
        expiries = [e for e in expiries if e]
        expiry = expiries[0] if expiries else ""

    inst_exp = [x for x in inst if _expiry_str_from_ts_ms(int(x.get("expiration_timestamp") or 0)) == expiry]

    summaries = deribit_get("/public/get_book_summary_by_currency", {"currency": currency, "kind": "option"}) or []
    by_name = { (s.get("instrument_name") or ""): s for s in summaries }

    raw_rows = []
    chain = []
    for x in inst_exp:
        name = x.get("instrument_name")
        if not name:
            continue
        s = by_name.get(name) or {}
        greeks = (s.get("greeks") or {})
        bid = float(s.get("bid_price") or 0.0)
        ask = float(s.get("ask_price") or 0.0)
        oi = float(s.get("open_interest") or 0.0)
        spot = float(s.get("underlying_price") or 0.0)
        gamma = float(greeks.get("gamma") or 0.0)
        iv = float(s.get("mark_iv") or 0.0)
        strike = float(x.get("strike") or 0.0)
        opt_type = str(x.get("option_type") or "")

        row = {
            "instrument_name": name,
            "strike": strike,
            "option_type": opt_type,
            "open_interest": oi,
            "gamma": gamma,
            "bid_price": bid,
            "ask_price": ask,
            "mark_iv": iv,
            "underlying_price": spot,
            "expiry": expiry,
        }
        raw_rows.append(row)
        chain.append({
            **row,
            "delta": float(greeks.get("delta") or 0.0),
            "vega": float(greeks.get("vega") or 0.0),
            "theta": float(greeks.get("theta") or 0.0),
            "mark_price": float(s.get("mark_price") or 0.0),
        })

    gex_rows = compute_gex_rows(raw_rows)
    strike_net = aggregate_by_strike(gex_rows)
    flip = gamma_flip(strike_net)
    walls = top_walls(strike_net, n=18)

    gex_by_name = {r.instrument_name: float(r.gex) for r in gex_rows}

    # enrich chain with gex
    for row in chain:
        row["gex"] = float(gex_by_name.get(row.get("instrument_name") or "", 0.0))

    # per-strike aggregation (call/put)
    per_strike: Dict[float, Dict[str, Any]] = {}
    for row in chain:
        k = float(row.get("strike") or 0.0)
        if k not in per_strike:
            per_strike[k] = {"strike": k, "call": None, "put": None, "net_gex": 0.0, "call_gex": 0.0, "put_gex": 0.0}
        opt = str(row.get("option_type") or "")
        if opt == "call":
            per_strike[k]["call"] = row
            per_strike[k]["call_gex"] = float(row.get("gex") or 0.0)
        elif opt == "put":
            per_strike[k]["put"] = row
            per_strike[k]["put_gex"] = float(row.get("gex") or 0.0)
        per_strike[k]["net_gex"] = float(per_strike[k]["call_gex"]) + float(per_strike[k]["put_gex"])

    per_strike_list = [per_strike[k] for k in sorted(per_strike.keys())]

    return {
        "ok": True,
        "currency": currency,
        "expiry": expiry,
        "spot": float(chain[0].get("underlying_price") or 0.0) if chain else 0.0,
        "regime": regime_text(strike_net, flip=flip),
        "flip": flip,
        "walls": [{"strike": k, "gex": v} for (k, v) in walls],
        "strike_net": [{"strike": k, "gex": v} for (k, v) in strike_net.items()],
        "per_strike": per_strike_list,
        "chain": chain,
    }


# -------------------- Altcoins API --------------------
ALTCOINS_DEFAULT = [
    "SOLUSDT",
    "XRPUSDT",
    "BNBUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "DOTUSDT",
    "MATICUSDT",
    "LTCUSDT",
    "TRXUSDT",
    "ATOMUSDT",
    "ARBUSDT",
    "OPUSDT",
    "APTUSDT",
    "SUIUSDT",
]


@app.get("/api/alt/symbols")
def alt_symbols(force: int = 0, limit: int = 5000, user: dict = Depends(get_user)):
    try:
        syms = binance_usdt_symbols(force=bool(force))
        if not syms:
            syms = ALTCOINS_DEFAULT
        limit = max(1, min(10000, int(limit)))
        return {"ok": True, "n": min(limit, len(syms)), "symbols": syms[:limit]}
    except Exception as e:
        # Fallback to a safe default list
        return {"ok": True, "n": len(ALTCOINS_DEFAULT), "symbols": ALTCOINS_DEFAULT, "warning": f"binance_symbols_failed: {e}"}


@app.get("/api/alt/ohlc")
def bybit_klines(symbol: str, tf: str, limit: int = 300) -> dict:
    interval = BYBIT_TF.get(tf, "15")
    url = BYBIT_BASE + "/v5/market/kline"
    params = {"category": "spot", "symbol": symbol, "interval": interval, "limit": limit}
    r = requests.get(url, params=params, timeout=10)
    r.raise_for_status()
    data = r.json() or {}
    lst = ((data.get("result") or {}).get("list") or [])
    # bybit returns newest->oldest
    lst = list(reversed(lst))

    t: list[float] = []
    o: list[float] = []
    h: list[float] = []
    l: list[float] = []
    c: list[float] = []
    v: list[float] = []

    for row in lst:
        ts = float(int(row[0]) // 1000)
        t.append(ts)
        o.append(float(row[1]))
        h.append(float(row[2]))
        l.append(float(row[3]))
        c.append(float(row[4]))
        v.append(float(row[5]))

    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def alt_ohlc(symbol: str = "SOLUSDT", tf: str = "15", candles: int = 300, user: dict = Depends(get_user)):
    candles = max(120, min(1500, int(candles)))
    sym = (symbol or "SOLUSDT").upper().strip()
    try:
        ohlc = binance_klines(symbol=sym, tf=tf, limit=candles)
        return {"ok": True, "exchange": "binance", "symbol": sym, "tf": tf, "candles": candles, "ohlc": ohlc}
    except Exception as e1:
        # fallback to Bybit spot
        try:
            ohlc = bybit_klines(symbol=sym, tf=tf, limit=candles)
            return {"ok": True, "exchange": "bybit", "symbol": sym, "tf": tf, "candles": candles, "ohlc": ohlc, "warning": f"binance_failed: {e1}"}
        except Exception as e2:
            raise HTTPException(status_code=502, detail=f"alt_ohlc_failed: binance={e1} | bybit={e2}")


# -------------------- News API --------------------
@app.get("/api/news")
def api_news(cat: str = "ALL", q: str = "", limit: int = 60, user: dict = Depends(get_user)):
    cat = (cat or "ALL").strip()
    ql = (q or "").strip().lower()
    items: list[dict] = []
    for c, name, url in NEWS_FEEDS:
        if cat != "ALL" and c != cat:
            continue
        for it in fetch_rss_items(url):
            it2 = dict(it)
            it2["cat"] = c
            it2["feed"] = name
            items.append(it2)

    # simple filter
    if ql:
        items = [it for it in items if ql in (it.get("title") or "").lower()]

    items.sort(key=lambda x: (int(x.get("score") or 0), float(x.get("ts") or 0.0)), reverse=True)
    limit = max(1, min(200, int(limit)))
    return {"ok": True, "n": min(limit, len(items)), "items": items[:limit]}


def _strip_html_to_text(html: str, max_chars: int = 12000) -> str:
    import re
    import html as html_mod

    s = html or ""
    # drop scripts/styles
    s = re.sub(r"(?is)<script.*?>.*?</script>", " ", s)
    s = re.sub(r"(?is)<style.*?>.*?</style>", " ", s)
    # drop comments
    s = re.sub(r"(?is)<!--.*?-->", " ", s)
    # replace <br> and <p> with newlines
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p>", "\n", s)
    # remove tags
    s = re.sub(r"(?is)<[^>]+>", " ", s)
    s = html_mod.unescape(s)
    # collapse whitespace but keep newlines
    s = re.sub(r"[\t\r ]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = s.strip()
    if len(s) > max_chars:
        s = s[:max_chars] + "\n\n[truncado]"
    return s


@app.get("/api/news/open")
def api_news_open(
    url: str,
    title: str = "",
    assets: str = "",
    score: int = 0,
    user: dict = Depends(get_user),
):
    # Best-effort page fetch. Some sites block; in that case we return minimal info.
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "cripto-desk-web/0.1"})
        r.raise_for_status()
        text = _strip_html_to_text(r.text)
        excerpt = ""
        try:
            excerpt = " ".join(text.split()[:60]).strip()
        except Exception:
            excerpt = ""
        return {"ok": True, "title": title or url, "url": url, "assets": assets, "score": int(score), "excerpt": excerpt, "text": text}
    except Exception as e:
        return {"ok": False, "title": title or url, "url": url, "assets": assets, "score": int(score), "excerpt": "", "text": "Não foi possível carregar a notícia automaticamente (site bloqueou ou timeout).\n\nAbra a fonte original."}


@app.exception_handler(HTTPException)
async def http_exc(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": exc.detail})


@app.exception_handler(Exception)
async def any_exc(_, exc: Exception):
    # Ensure frontend always receives JSON (avoid "Unexpected token <" on 500 HTML)
    return JSONResponse(status_code=500, content={"ok": False, "error": f"server_error: {exc}"})
