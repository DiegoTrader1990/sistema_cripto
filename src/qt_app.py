from __future__ import annotations

import time
import math
import json
from dataclasses import dataclass
from typing import Dict, Any, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets
import pyqtgraph as pg
import requests

from .util import log, crash, now_str, parse_deribit_expiry, days_to_expiry
from .deribit_api import DeribitPublicClient
from .testdata import gen_ohlc, gen_options_chain
from .gex import compute_gex_rows, aggregate_by_strike, gamma_flip, top_walls, regime_text, GexRow
from .strategy import build_action_context, plan_from_selected_level


# -------------------- small helpers --------------------
def fmt_num(x: float, nd: int = 2) -> str:
    try:
        return f"{float(x):,.{nd}f}"
    except Exception:
        return "—"


def make_card(title: str) -> QtWidgets.QFrame:
    f = QtWidgets.QFrame()
    f.setObjectName("Card")
    f.setFrameShape(QtWidgets.QFrame.StyledPanel)
    v = QtWidgets.QVBoxLayout(f)
    v.setContentsMargins(12, 10, 12, 10)
    v.setSpacing(8)
    lab = QtWidgets.QLabel(title)
    lab.setObjectName("CardTitle")
    v.addWidget(lab)
    return f


class SmartViewBox(pg.ViewBox):
    """
    TradingView-like usability:
      - Normal drag: pan
      - Wheel: zoom X/Y
      - SHIFT + drag: zoom Y (vertical scale) like pulling the price scale
      - CTRL + drag: zoom X
    """
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.setMouseMode(self.PanMode)
        self._drag_last = None

    def mouseDragEvent(self, ev, axis=None):
        mods = ev.modifiers()
        if mods & QtCore.Qt.ShiftModifier:
            # zoom Y
            if ev.isFinish():
                self._drag_last = None
                ev.accept()
                return
            p = ev.pos()
            if self._drag_last is None:
                self._drag_last = p
                ev.accept()
                return
            dy = p.y() - self._drag_last.y()
            self._drag_last = p
            vr = self.viewRange()
            y0, y1 = vr[1]
            cy = (y0 + y1) / 2.0
            span = max(1e-9, (y1 - y0))
            # dy>0 => zoom out, dy<0 => zoom in
            factor = math.exp(dy / 180.0)
            new_span = span * factor
            self.setYRange(cy - new_span/2.0, cy + new_span/2.0, padding=0)
            ev.accept()
            return
        if mods & QtCore.Qt.ControlModifier:
            # zoom X
            if ev.isFinish():
                self._drag_last = None
                ev.accept()
                return
            p = ev.pos()
            if self._drag_last is None:
                self._drag_last = p
                ev.accept()
                return
            dx = p.x() - self._drag_last.x()
            self._drag_last = p
            vr = self.viewRange()
            x0, x1 = vr[0]
            cx = (x0 + x1) / 2.0
            span = max(1e-9, (x1 - x0))
            factor = math.exp(-dx / 180.0)
            new_span = span * factor
            self.setXRange(cx - new_span/2.0, cx + new_span/2.0, padding=0)
            ev.accept()
            return

        super().mouseDragEvent(ev, axis=axis)


class CandlestickItem(pg.GraphicsObject):
    def __init__(self):
        super().__init__()
        self.data: List[Tuple[float,float,float,float,float]] = []
        self.picture = None
        self._w = 0.6

    def setData(self, data: List[Tuple[float,float,float,float,float]]):
        self.data = data
        # Dynamic candle width (depends on time spacing)
        try:
            if len(self.data) >= 2:
                xs = [d[0] for d in self.data]
                diffs = [abs(xs[i+1] - xs[i]) for i in range(len(xs)-1) if xs[i+1] != xs[i]]
                if diffs:
                    diffs.sort()
                    self._w = max(0.25, diffs[len(diffs)//2] * 0.7)
        except Exception:
            self._w = 0.6
        self._regen()
        self.update()

    def _regen(self):
        self.picture = QtGui.QPicture()
        p = QtGui.QPainter(self.picture)
        if not self.data:
            p.end()
            return

        w = self._w
        for (t, o, c, lo, hi) in self.data:
            up = c >= o
            col = QtGui.QColor("#25d695" if up else "#ff4d6d")
            pen = QtGui.QPen(col); pen.setWidthF(1.0)
            p.setPen(pen)
            p.drawLine(QtCore.QPointF(t, lo), QtCore.QPointF(t, hi))
            p.setBrush(QtGui.QBrush(col))
            h = c - o
            if h == 0:
                h = 0.0001
            rect = QtCore.QRectF(t - w/2, o, w, h)
            p.drawRect(rect.normalized())

        p.end()

    def paint(self, p, *args):
        if self.picture:
            p.drawPicture(0, 0, self.picture)

    def boundingRect(self):
        if not self.data:
            return QtCore.QRectF()
        xs = [d[0] for d in self.data]
        lows = [d[3] for d in self.data]
        highs = [d[4] for d in self.data]
        return QtCore.QRectF(min(xs)-1, min(lows), (max(xs)-min(xs))+2, (max(highs)-min(lows)))


# -------------------- News --------------------
@dataclass
class NewsItem:
    ts: float
    source: str
    title: str
    link: str
    assets: str
    score: int


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


def _tag_assets(title: str) -> Tuple[str, int]:
    t = (title or "").lower()
    hits = []
    score = 0
    for sym, kws in ASSET_KEYWORDS.items():
        for k in kws:
            if k in t:
                hits.append(sym)
                score += 10
                break
    # macro boosts
    macro = ["federal reserve", "fed", "cpi", "inflation", "rates", "treasury", "dollar", "risk off", "risk-on", "geopolit"]
    for m in macro:
        if m in t:
            score += 6
            break
    if not hits:
        # default relevance: majors
        hits = ["BTC", "ETH"]
    return ",".join(sorted(set(hits))), int(score)


def fetch_rss_items(url: str, timeout: float = 8.0) -> List[NewsItem]:
    # simple xml parse without extra deps
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent":"gex-desk-pro/7.9"})
        r.raise_for_status()
        xml = r.text
        items = []
        # naive split; good enough for RSS
        for chunk in xml.split("<item>")[1:]:
            title = _between(chunk, "<title>", "</title>")
            link = _between(chunk, "<link>", "</link>")
            pub = _between(chunk, "<pubDate>", "</pubDate>")
            src = _between(chunk, "<source>", "</source>") or ""
            assets, score = _tag_assets(title)
            ts = time.time()
            items.append(NewsItem(ts=ts, source=src.strip() or "RSS", title=title.strip(), link=link.strip(), assets=assets, score=score))
        return items[:60]
    except Exception:
        return []


def _between(s: str, a: str, b: str) -> str:
    try:
        i = s.find(a)
        if i < 0:
            return ""
        j = s.find(b, i + len(a))
        if j < 0:
            return ""
        return s[i+len(a):j]
    except Exception:
        return ""


# -------------------- Altcoins providers --------------------
ALTCOINS_DEFAULT = [
    "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
    "MATICUSDT", "LTCUSDT", "TRXUSDT", "ATOMUSDT", "ARBUSDT", "OPUSDT", "APTUSDT", "SUIUSDT",
]

ALT_META = {
    "SOLUSDT": {"name":"Solana", "sector":"L1", "launch":"2020"},
    "XRPUSDT": {"name":"XRP", "sector":"Payments", "launch":"2012"},
    "BNBUSDT": {"name":"BNB", "sector":"Exchange/L1", "launch":"2017"},
    "ADAUSDT": {"name":"Cardano", "sector":"L1", "launch":"2017"},
    "DOGEUSDT": {"name":"Dogecoin", "sector":"Meme", "launch":"2013"},
    "AVAXUSDT": {"name":"Avalanche", "sector":"L1", "launch":"2020"},
    "LINKUSDT": {"name":"Chainlink", "sector":"Oracle", "launch":"2017"},
    "DOTUSDT": {"name":"Polkadot", "sector":"L0", "launch":"2020"},
    "MATICUSDT": {"name":"Polygon", "sector":"L2", "launch":"2019"},
    "LTCUSDT": {"name":"Litecoin", "sector":"Payments", "launch":"2011"},
    "TRXUSDT": {"name":"Tron", "sector":"L1", "launch":"2017"},
    "ATOMUSDT": {"name":"Cosmos", "sector":"L0", "launch":"2019"},
    "ARBUSDT": {"name":"Arbitrum", "sector":"L2", "launch":"2023"},
    "OPUSDT": {"name":"Optimism", "sector":"L2", "launch":"2022"},
    "APTUSDT": {"name":"Aptos", "sector":"L1", "launch":"2022"},
    "SUIUSDT": {"name":"Sui", "sector":"L1", "launch":"2023"},
}

BINANCE_BASE = "https://api.binance.com"
BYBIT_BASE = "https://api.bybit.com"

BINANCE_TF = {"1":"1m","5":"5m","15":"15m","60":"1h","240":"4h","1D":"1d"}
BYBIT_TF = {"1":"1","5":"5","15":"15","60":"60","240":"240","1D":"D"}

def binance_klines(symbol: str, tf: str, limit: int = 300) -> List[Tuple[int,float,float,float,float,float]]:
    interval = BINANCE_TF.get(tf, "1m")
    url = BINANCE_BASE + "/api/v3/klines"
    r = requests.get(url, params={"symbol":symbol, "interval":interval, "limit":limit}, timeout=8)
    r.raise_for_status()
    out = []
    for k in r.json():
        ts = int(k[0] // 1000)
        o,h,l,c,v = float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])
        out.append((ts,o,c,l,h,v))
    return out

def binance_ticker(symbol: str) -> Dict[str, Any]:
    url = BINANCE_BASE + "/api/v3/ticker/24hr"
    r = requests.get(url, params={"symbol":symbol}, timeout=8)
    r.raise_for_status()
    return r.json()


_BINANCE_SYMBOLS_CACHE = {"ts": 0.0, "symbols": []}

def binance_usdt_symbols(force: bool = False) -> List[str]:
    """Fetch all Binance spot symbols quoted in USDT (best-effort)."""
    try:
        if (not force) and _BINANCE_SYMBOLS_CACHE["symbols"] and (time.time() - float(_BINANCE_SYMBOLS_CACHE["ts"])) < 6*3600:
            return list(_BINANCE_SYMBOLS_CACHE["symbols"])
    except Exception:
        pass

    url = BINANCE_BASE + "/api/v3/exchangeInfo"
    r = requests.get(url, timeout=12)
    r.raise_for_status()
    data = r.json() or {}
    out = []
    for s in (data.get("symbols") or []):
        try:
            if (s.get("status") != "TRADING"):
                continue
            if (s.get("quoteAsset") or "").upper() != "USDT":
                continue
            sym = (s.get("symbol") or "").upper().strip()
            if not sym or not sym.endswith("USDT"):
                continue
            # ignore leveraged tokens and some weird wrappers
            bad = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")
            if any(sym.endswith(x) for x in bad):
                continue
            out.append(sym)
        except Exception:
            continue

    out = sorted(set(out))
    try:
        _BINANCE_SYMBOLS_CACHE["symbols"] = out
        _BINANCE_SYMBOLS_CACHE["ts"] = time.time()
    except Exception:
        pass
    return out

def bybit_klines(symbol: str, tf: str, limit: int = 300) -> List[Tuple[int,float,float,float,float,float]]:
    interval = BYBIT_TF.get(tf, "1")
    url = BYBIT_BASE + "/v5/market/kline"
    params = {"category":"linear", "symbol":symbol.replace("USDT","USDT"), "interval":interval, "limit":limit}
    r = requests.get(url, params=params, timeout=8)
    r.raise_for_status()
    data = r.json()
    lst = ((data.get("result") or {}).get("list") or [])
    out = []
    for row in reversed(lst):  # oldest->newest
        ts = int(int(row[0]) // 1000)
        o = float(row[1]); h = float(row[2]); l = float(row[3]); c = float(row[4]); v = float(row[5])
        out.append((ts,o,c,l,h,v))
    return out


# -------------------- Main Window --------------------
class DeskWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Deribit GEX Desk PRO v7.9 (DESK+ALT+NEWS)")
        self.resize(1780, 1000)

        self.client = DeribitPublicClient(timeout=7.0)

        # config
        self.mode = "LIVE"
        self.instrument = "BTC-PERPETUAL"
        self.tf = "60"
        self.auto_sec = 15
        self.chain_refresh_sec = 25
        self.candles_n = 900

        # GEX scope controls (latency vs coverage)
        self.gex_scope = "WIDE"   # FAST / WIDE / ULTRA
        self.gex_window_pct = 0.45
        self.gex_max_instruments = 320

        # state
        self.payload: Optional[Dict[str, Any]] = None
        self.rows: List[GexRow] = []
        self.strike_net: Dict[float, float] = {}
        self.flip: Optional[float] = None
        self.walls: List[Tuple[float, float]] = []
        self.selected_strike: Optional[float] = None
        self.selected_level: Optional[float] = None
        self._last_latency_ms = 0.0
        self._last_chain_ts = 0.0
        self._last_refresh = 0.0

        # altcoins state
        self.alt_exchange = "Binance"
        self.alt_symbol = "SOLUSDT"
        self.alt_tf = "15"
        self.alt_last: Optional[Dict[str, Any]] = None
        self._alt_all_symbols: List[str] = list(ALTCOINS_DEFAULT)

        # news state
        self.news_items: List[NewsItem] = []

        self._build_ui()
        self._apply_theme()

        self.timer = QtCore.QTimer(self)
        self.timer.timeout.connect(self._auto_loop)
        self.timer.start(1000)

        QtCore.QTimer.singleShot(250, self.refresh_all)
        # Load extra tabs soon after boot so the UI doesn't look "empty".
        QtCore.QTimer.singleShot(700, self.refresh_altcoins)
        QtCore.QTimer.singleShot(900, self.refresh_news)

    # ---------------- UI ----------------
    def _apply_theme(self):
        self.setStyleSheet("""
            QMainWindow { background: #0e1116; }
            QWidget { color: #d6d9df; font-family: Segoe UI; font-size: 11px; }
            QComboBox, QSpinBox, QPushButton, QLineEdit {
                background: #121824; border: 1px solid #232a36; padding: 6px; border-radius: 6px;
            }
            QPushButton:hover { border-color: #2c7dff; }
            QTabWidget::pane { border: 1px solid #232a36; top:-1px; }
            QTabBar::tab { background: #121824; padding: 8px 14px; border: 1px solid #232a36; border-bottom: none; }
            QTabBar::tab:selected { background: #0f1520; border-color: #2c7dff; }
            QFrame#Card { background: #0f1520; border: 1px solid #232a36; border-radius: 10px; }
            QLabel#CardTitle { font-size: 11px; font-weight: 700; color: #aeb4be; }
            QLabel#KPI { font-size: 22px; font-weight: 800; color: #e8eaee; }
            QLabel#Small { color: #aeb4be; }
            QTextEdit { background: #0b0f17; border: 1px solid #232a36; border-radius: 8px; }
            QTableWidget { background: #0b0f17; border: 1px solid #232a36; gridline-color: #1a2230; }
            QHeaderView::section { background: #121824; border: 1px solid #232a36; padding: 6px; color: #aeb4be; }
        """)

    def _build_ui(self):
        central = QtWidgets.QWidget()
        self.setCentralWidget(central)
        root = QtWidgets.QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        # top bar
        bar = QtWidgets.QHBoxLayout()
        root.addLayout(bar)

        self.cb_mode = QtWidgets.QComboBox(); self.cb_mode.addItems(["LIVE", "TEST"])
        self.cb_inst = QtWidgets.QComboBox(); self.cb_inst.addItems(["BTC-PERPETUAL", "ETH-PERPETUAL"])
        self.cb_tf = QtWidgets.QComboBox(); self.cb_tf.addItems(["1","5","15","60","240","1D"])
        self.sp_candles = QtWidgets.QSpinBox(); self.sp_candles.setRange(120, 3000); self.sp_candles.setValue(900)
        self.cb_scope = QtWidgets.QComboBox(); self.cb_scope.addItems(["FAST","WIDE","ULTRA"]); self.cb_scope.setCurrentText(self.gex_scope)
        self.sp_auto = QtWidgets.QSpinBox(); self.sp_auto.setRange(5, 120); self.sp_auto.setValue(self.auto_sec)
        self.btn_refresh = QtWidgets.QPushButton("Atualizar")
        self.lbl_status = QtWidgets.QLabel("Pronto"); self.lbl_status.setObjectName("Small")
        self.lbl_last = QtWidgets.QLabel("Última: —"); self.lbl_last.setObjectName("Small")
        self.lbl_lat = QtWidgets.QLabel("Lat: —"); self.lbl_lat.setObjectName("Small")
        self.lbl_hover = QtWidgets.QLabel("—"); self.lbl_hover.setObjectName("Small")

        bar.addWidget(QtWidgets.QLabel("Modo:")); bar.addWidget(self.cb_mode)
        bar.addSpacing(8)
        bar.addWidget(QtWidgets.QLabel("Instrument:")); bar.addWidget(self.cb_inst)
        bar.addSpacing(8)
        bar.addWidget(QtWidgets.QLabel("TF:")); bar.addWidget(self.cb_tf)
        bar.addSpacing(8)
        bar.addWidget(QtWidgets.QLabel("Candles:")); bar.addWidget(self.sp_candles)
        bar.addSpacing(8)
        bar.addWidget(QtWidgets.QLabel("GEX:")); bar.addWidget(self.cb_scope)
        bar.addSpacing(8)
        bar.addWidget(QtWidgets.QLabel("Auto s:")); bar.addWidget(self.sp_auto)
        bar.addSpacing(10)
        bar.addWidget(self.btn_refresh)
        bar.addStretch(1)
        bar.addWidget(self.lbl_hover); bar.addSpacing(12)
        bar.addWidget(self.lbl_status); bar.addSpacing(12)
        bar.addWidget(self.lbl_lat); bar.addSpacing(12)
        bar.addWidget(self.lbl_last)

        self.btn_refresh.clicked.connect(self.refresh_all)
        self.cb_mode.currentTextChanged.connect(self._on_cfg_change)
        self.cb_inst.currentTextChanged.connect(self._on_cfg_change)
        self.cb_tf.currentTextChanged.connect(self._on_cfg_change)
        self.cb_scope.currentTextChanged.connect(self._on_cfg_change)
        self.sp_candles.valueChanged.connect(self._on_cfg_change)
        self.sp_auto.valueChanged.connect(self._on_cfg_change)

        # tabs
        self.tabs = QtWidgets.QTabWidget()
        root.addWidget(self.tabs, 1)

        self.tab_desk = QtWidgets.QWidget()
        self.tab_alt = QtWidgets.QWidget()
        self.tab_news = QtWidgets.QWidget()
        self.tab_options = QtWidgets.QWidget()
        self.tab_logs = QtWidgets.QWidget()

        self.tabs.addTab(self.tab_desk, "Desk")
        self.tabs.addTab(self.tab_alt, "Altcoins")
        self.tabs.addTab(self.tab_news, "News")
        self.tabs.addTab(self.tab_options, "Options")
        self.tabs.addTab(self.tab_logs, "Logs")

        # Lazy refresh: if user opens Altcoins/News and it's empty, fetch immediately.
        self.tabs.currentChanged.connect(self._on_tab_changed)

        self._build_desk()
        self._build_altcoins()
        self._build_news()
        self._build_options()
        self._build_logs()

    def _build_desk(self):
        lay = QtWidgets.QVBoxLayout(self.tab_desk)
        lay.setContentsMargins(0,0,0,0)
        lay.setSpacing(10)

        # KPI row
        row = QtWidgets.QHBoxLayout(); row.setSpacing(10)
        lay.addLayout(row)

        self.card_spot = make_card("SPOT / REGIME")
        self.card_net = make_card("NET GEX (proxy)")
        self.card_walls = make_card("WALLS (nearest)")
        self.card_action = make_card("ACTION (operational)")
        self.card_health = make_card("HEALTH")

        row.addWidget(self.card_spot, 2)
        row.addWidget(self.card_net, 1)
        row.addWidget(self.card_walls, 1)
        row.addWidget(self.card_action, 3)
        row.addWidget(self.card_health, 1)

        def kpi(txt="—"):
            l = QtWidgets.QLabel(txt); l.setObjectName("KPI"); return l
        def small(txt="—"):
            l = QtWidgets.QLabel(txt); l.setObjectName("Small"); l.setWordWrap(True); return l

        self.k_spot = kpi("—")
        self.k_reg = small("—")
        self.card_spot.layout().addWidget(self.k_spot)
        self.card_spot.layout().addWidget(self.k_reg)

        self.k_net = kpi("—")
        self.k_flip = small("Flip: —")
        self.card_net.layout().addWidget(self.k_net)
        self.card_net.layout().addWidget(self.k_flip)

        self.k_wall = small("Below: — | Above: —")
        self.card_walls.layout().addWidget(self.k_wall)

        self.k_action = small("—")
        self.card_action.layout().addWidget(self.k_action)

        self.k_health = small("Mode: —\nLatency: —\nScope: —")
        self.card_health.layout().addWidget(self.k_health)

        # Main splitter (charts vs cards)
        self.split_main = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        lay.addWidget(self.split_main, 1)

        # left: charts splitter vertical
        left = QtWidgets.QWidget()
        llay = QtWidgets.QVBoxLayout(left)
        llay.setContentsMargins(0,0,0,0)
        llay.setSpacing(8)

        # chart controls
        ctl = QtWidgets.QHBoxLayout()
        llay.addLayout(ctl)
        self.btn_fit = QtWidgets.QPushButton("Fit Y")
        self.btn_reset = QtWidgets.QPushButton("Reset view")
        self.cb_autoy = QtWidgets.QComboBox(); self.cb_autoy.addItems(["AutoY: ON", "AutoY: OFF"])
        # Smaller charts by default (more room for cards). User can adjust via Charts% slider.
        self.sl_ratio = QtWidgets.QSlider(QtCore.Qt.Horizontal)
        self.sl_ratio.setRange(30, 75)
        self.sl_ratio.setValue(32)  # mesa default: gráfico menor
        ctl.addWidget(self.btn_fit); ctl.addWidget(self.btn_reset); ctl.addWidget(self.cb_autoy)
        ctl.addStretch(1)
        ctl.addWidget(QtWidgets.QLabel("Charts%"))
        ctl.addWidget(self.sl_ratio)

        self.btn_fit.clicked.connect(self._fit_y_visible)
        self.btn_reset.clicked.connect(self._reset_views)
        self.cb_autoy.currentTextChanged.connect(lambda *_: None)
        self.sl_ratio.valueChanged.connect(self._apply_ratio)

        self.split_charts = QtWidgets.QSplitter(QtCore.Qt.Vertical)
        llay.addWidget(self.split_charts, 1)

        # Candle plot with SmartViewBox + Date axis
        self.candle_vb = SmartViewBox()
        axis_items = {"bottom": pg.DateAxisItem(orientation="bottom")}
        self.candle_plot = pg.PlotWidget(viewBox=self.candle_vb, axisItems=axis_items)
        self.candle_plot.setBackground("#0f1520")
        self.candle_plot.showGrid(x=True, y=True, alpha=0.25)

        # Price axis on the RIGHT (TradingView-like)
        self.candle_plot.showAxis("right")
        self.candle_plot.hideAxis("left")
        self.candle_plot.setLabel("right", "price")

        self.candle_plot.setLabel("bottom", "time")
        self.candle_plot.getAxis("bottom").setStyle(tickTextOffset=10)
        self.candle_item = CandlestickItem()
        self.candle_plot.addItem(self.candle_item)

        # crosshair
        self.vline = pg.InfiniteLine(angle=90, movable=False, pen=pg.mkPen("#2c7dff", width=1))
        self.hline = pg.InfiniteLine(angle=0, movable=False, pen=pg.mkPen("#2c7dff", width=1))
        self.candle_plot.addItem(self.vline, ignoreBounds=True)
        self.candle_plot.addItem(self.hline, ignoreBounds=True)
        self._proxy = pg.SignalProxy(self.candle_plot.scene().sigMouseMoved, rateLimit=60, slot=self._on_mouse_move)
        self.candle_plot.scene().sigMouseClicked.connect(self._on_candle_click)

        self.split_charts.addWidget(self.candle_plot)

        # GEX plot
        self.gex_plot = pg.PlotWidget()
        self.gex_plot.setBackground("#0f1520")
        self.gex_plot.showGrid(x=True, y=True, alpha=0.25)
        self.gex_plot.setLabel("left", "net gex (proxy)")
        self.gex_plot.setLabel("bottom", "strike")
        self.gex_plot.setMouseEnabled(x=True, y=True)
        self.gex_plot.scene().sigMouseClicked.connect(self._on_gex_click)
        self.split_charts.addWidget(self.gex_plot)
        self.gex_bars = None

        self.split_main.addWidget(left)

        # right: cards stack
        right = QtWidgets.QWidget()
        rlay = QtWidgets.QVBoxLayout(right)
        rlay.setContentsMargins(0,0,0,0)
        rlay.setSpacing(10)

        self.card_ctx = make_card("CONTEXT (levels / selection)")
        self.ctx_text = QtWidgets.QTextEdit(); self.ctx_text.setReadOnly(True); self.ctx_text.setFixedHeight(120)
        self.card_ctx.layout().addWidget(self.ctx_text)
        rlay.addWidget(self.card_ctx, 1)

        self.card_level = make_card("LEVEL DETAILS (click a wall/flip or a GEX bar)")
        self.level_text = QtWidgets.QTextEdit(); self.level_text.setReadOnly(True); self.level_text.setFixedHeight(120)
        self.card_level.layout().addWidget(self.level_text)
        rlay.addWidget(self.card_level, 1)

        self.card_strategy = make_card("STRATEGY (based on selected level)")
        self.strategy_text = QtWidgets.QTextEdit(); self.strategy_text.setReadOnly(True); self.strategy_text.setFixedHeight(150)
        self.card_strategy.layout().addWidget(self.strategy_text)
        rlay.addWidget(self.card_strategy, 1)

        self.card_plan = make_card("TRADE PLANNER (simulate RR)")
        grid = QtWidgets.QGridLayout()
        grid.setHorizontalSpacing(10)
        grid.setVerticalSpacing(8)
        self.card_plan.layout().addLayout(grid)

        self.ed_entry = QtWidgets.QLineEdit("—")
        self.ed_stop = QtWidgets.QLineEdit("—")
        self.ed_target = QtWidgets.QLineEdit("—")
        self.lbl_rr = QtWidgets.QLabel("RR: —"); self.lbl_rr.setObjectName("Small")
        self.btn_autofill = QtWidgets.QPushButton("Auto-fill")
        self.btn_calc = QtWidgets.QPushButton("Calc RR")
        self.btn_autofill.clicked.connect(self._autofill_plan)
        self.btn_calc.clicked.connect(self._calc_rr)

        grid.addWidget(QtWidgets.QLabel("Entry"), 0,0); grid.addWidget(self.ed_entry, 0,1)
        grid.addWidget(QtWidgets.QLabel("Stop"), 1,0); grid.addWidget(self.ed_stop, 1,1)
        grid.addWidget(QtWidgets.QLabel("Target"), 2,0); grid.addWidget(self.ed_target, 2,1)
        grid.addWidget(self.btn_autofill, 0,2)
        grid.addWidget(self.btn_calc, 1,2)
        grid.addWidget(self.lbl_rr, 2,2)

        self.tbl_sug = QtWidgets.QTableWidget(0, 9)
        self.tbl_sug.setHorizontalHeaderLabels(["instrument","type","strike","expiry","dte","gex","bid","ask","oi"])
        self.tbl_sug.horizontalHeader().setStretchLastSection(True)
        self.tbl_sug.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.tbl_sug.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.tbl_sug.setMinimumHeight(160)
        self.card_plan.layout().addWidget(self.tbl_sug)

        note = QtWidgets.QLabel("Dica: SHIFT+arrastar no gráfico (candles) ajusta o zoom vertical. CTRL+arrastar ajusta o zoom horizontal. Clique em wall/flip ou em barra do GEX para preencher os cards.")
        note.setObjectName("Small")
        note.setWordWrap(True)
        self.card_plan.layout().addWidget(note)

        rlay.addWidget(self.card_plan, 2)

        self.split_main.addWidget(right)

        # default sizes (more cards, smaller charts)
        self.split_main.setSizes([650, 1250])  # mesa default: mais espaço para cards
        self.split_charts.setSizes([330, 170])  # mesa default: compactar charts

        # level lines store
        self._level_lines: List[pg.InfiniteLine] = []
        self._selected_line: Optional[pg.InfiniteLine] = None

    def _build_altcoins(self):
        lay = QtWidgets.QVBoxLayout(self.tab_alt)
        lay.setContentsMargins(0,0,0,0)
        lay.setSpacing(10)

        top = QtWidgets.QHBoxLayout(); top.setSpacing(10)
        lay.addLayout(top)

        self.cb_alt_ex = QtWidgets.QComboBox(); self.cb_alt_ex.addItems(["Binance","Bybit"])
        self.cb_alt_tf = QtWidgets.QComboBox(); self.cb_alt_tf.addItems(["1","5","15","60","240","1D"]); self.cb_alt_tf.setCurrentText(self.alt_tf)
        self.sp_alt_candles = QtWidgets.QSpinBox(); self.sp_alt_candles.setRange(120, 3000); self.sp_alt_candles.setValue(900)
        self.cb_alt_sym = QtWidgets.QComboBox(); self.cb_alt_sym.addItems(ALTCOINS_DEFAULT)
        self.ed_alt_filter = QtWidgets.QLineEdit(); self.ed_alt_filter.setPlaceholderText("Filtrar (ex: SOL)")
        self.btn_alt_load = QtWidgets.QPushButton("Carregar lista")
        self.btn_alt = QtWidgets.QPushButton("Atualizar Alt")
        self.lbl_alt = QtWidgets.QLabel("—"); self.lbl_alt.setObjectName("Small")

        top.addWidget(QtWidgets.QLabel("Exchange:")); top.addWidget(self.cb_alt_ex)
        top.addWidget(QtWidgets.QLabel("Symbol:")); top.addWidget(self.cb_alt_sym)
        top.addWidget(self.ed_alt_filter)
        top.addWidget(self.btn_alt_load)
        top.addWidget(QtWidgets.QLabel("TF:")); top.addWidget(self.cb_alt_tf)
        top.addWidget(QtWidgets.QLabel("Candles:")); top.addWidget(self.sp_alt_candles)
        top.addWidget(self.btn_alt)
        top.addStretch(1)
        top.addWidget(self.lbl_alt)

        self.btn_alt.clicked.connect(self.refresh_altcoins)
        self.btn_alt_load.clicked.connect(self._load_altcoins_list)
        self.ed_alt_filter.textChanged.connect(self._filter_altcoins_combo)

        # Splitter: chart + cards
        split = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        lay.addWidget(split, 1)

        # left chart
        self.alt_vb = SmartViewBox()
        self.alt_plot = pg.PlotWidget(viewBox=self.alt_vb)
        self.alt_plot.setBackground("#0f1520")
        self.alt_plot.showGrid(x=True, y=True, alpha=0.25)

        # Price axis on the RIGHT
        self.alt_plot.showAxis("right")
        self.alt_plot.hideAxis("left")
        self.alt_plot.setLabel("right", "price")

        self.alt_plot.setLabel("bottom", "time")
        self.alt_item = CandlestickItem()
        self.alt_plot.addItem(self.alt_item)
        split.addWidget(self.alt_plot)

        # right cards
        right = QtWidgets.QWidget()
        rlay = QtWidgets.QVBoxLayout(right); rlay.setContentsMargins(0,0,0,0); rlay.setSpacing(10)

        self.card_alt_ctx = make_card("ALTCOIN SNAPSHOT")
        self.alt_ctx = QtWidgets.QTextEdit(); self.alt_ctx.setReadOnly(True); self.alt_ctx.setFixedHeight(170)
        self.card_alt_ctx.layout().addWidget(self.alt_ctx)
        rlay.addWidget(self.card_alt_ctx)

        self.card_alt_life = make_card("ASSET LIFE (metadata)")
        self.alt_life = QtWidgets.QTextEdit(); self.alt_life.setReadOnly(True); self.alt_life.setFixedHeight(190)
        self.card_alt_life.layout().addWidget(self.alt_life)
        rlay.addWidget(self.card_alt_life)

        self.card_alt_signals = make_card("ACTION (altcoin)")
        self.alt_signals = QtWidgets.QTextEdit(); self.alt_signals.setReadOnly(True); self.alt_signals.setFixedHeight(170)
        self.card_alt_signals.layout().addWidget(self.alt_signals)
        rlay.addWidget(self.card_alt_signals, 1)

        split.addWidget(right)
        split.setSizes([1100, 600])

    def _build_news(self):
        lay = QtWidgets.QVBoxLayout(self.tab_news)
        lay.setContentsMargins(0,0,0,0)
        lay.setSpacing(10)

        top = QtWidgets.QHBoxLayout(); top.setSpacing(10)
        lay.addLayout(top)

        self.btn_news = QtWidgets.QPushButton("Atualizar notícias")
        self.cb_news = QtWidgets.QComboBox(); self.cb_news.addItems(["ALL","Crypto","Macro"])
        self.ed_news = QtWidgets.QLineEdit(); self.ed_news.setPlaceholderText("Filtrar por palavra (ex: solana, fed, etf)")
        self.lbl_news = QtWidgets.QLabel("—"); self.lbl_news.setObjectName("Small")

        top.addWidget(self.btn_news)
        top.addWidget(QtWidgets.QLabel("Categoria:")); top.addWidget(self.cb_news)
        top.addWidget(self.ed_news, 1)
        top.addWidget(self.lbl_news)

        self.btn_news.clicked.connect(self.refresh_news)
        self.cb_news.currentTextChanged.connect(self._paint_news)
        self.ed_news.textChanged.connect(self._paint_news)

        self.tbl_news = QtWidgets.QTableWidget(0, 5)
        self.tbl_news.setHorizontalHeaderLabels(["score","assets","source","title","link"])
        self.tbl_news.horizontalHeader().setStretchLastSection(True)
        self.tbl_news.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.tbl_news.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.tbl_news.cellDoubleClicked.connect(self._open_news_link)

        lay.addWidget(self.tbl_news, 1)

        hint = QtWidgets.QLabel("Dica: duplo-clique na notícia abre no navegador. A coluna 'assets' é uma sugestão automática de relevância (pode ajustar depois).")
        hint.setObjectName("Small"); hint.setWordWrap(True)
        lay.addWidget(hint)

    def _build_options(self):
        lay = QtWidgets.QVBoxLayout(self.tab_options)
        lay.setContentsMargins(0,0,0,0)
        lay.setSpacing(10)

        top = QtWidgets.QHBoxLayout()
        lay.addLayout(top)
        self.cb_filter = QtWidgets.QComboBox(); self.cb_filter.addItems(["ALL","CALL","PUT"])
        self.btn_apply = QtWidgets.QPushButton("Aplicar")
        self.lbl_exp = QtWidgets.QLabel("Expiry: —"); self.lbl_exp.setObjectName("Small")
        self.btn_apply.clicked.connect(self._paint_options)
        top.addWidget(QtWidgets.QLabel("Filtro:")); top.addWidget(self.cb_filter); top.addWidget(self.btn_apply)
        top.addStretch(1)
        top.addWidget(self.lbl_exp)

        self.tbl_opt = QtWidgets.QTableWidget(0, 11)
        self.tbl_opt.setHorizontalHeaderLabels(["instrument","type","strike","expiry","dte","oi","gamma","gex","bid","ask","iv"])
        self.tbl_opt.horizontalHeader().setStretchLastSection(True)
        self.tbl_opt.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.tbl_opt.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        lay.addWidget(self.tbl_opt, 1)

    def _build_logs(self):
        lay = QtWidgets.QVBoxLayout(self.tab_logs)
        self.log_box = QtWidgets.QTextEdit()
        self.log_box.setReadOnly(True)
        lay.addWidget(self.log_box, 1)
        btn = QtWidgets.QPushButton("Recarregar logs")
        btn.clicked.connect(self._reload_logs)
        lay.addWidget(btn)

    # ---------------- Events ----------------
    def _on_cfg_change(self, *_):
        self.mode = self.cb_mode.currentText()
        self.instrument = self.cb_inst.currentText()
        self.tf = self.cb_tf.currentText()
        self.auto_sec = int(self.sp_auto.value())
        self.candles_n = int(self.sp_candles.value())
        self.gex_scope = self.cb_scope.currentText()
        if self.gex_scope == "FAST":
            self.gex_window_pct = 0.28
            self.gex_max_instruments = 160
        elif self.gex_scope == "WIDE":
            self.gex_window_pct = 0.45
            self.gex_max_instruments = 320
        else:
            self.gex_window_pct = 0.65
            self.gex_max_instruments = 520

    def _apply_ratio(self, val: int):
        # charts% slider affects horizontal splitter sizes
        try:
            tot = 1000
            left = int(tot * (val/100.0))
            right = tot - left
            self.split_main.setSizes([left, right])
        except Exception:
            pass

    def _reset_views(self):
        try:
            self.candle_plot.enableAutoRange(axis=pg.ViewBox.XYAxes, enable=True)
            self.gex_plot.enableAutoRange(axis=pg.ViewBox.XYAxes, enable=True)
            self._fit_y_visible()
        except Exception:
            pass

    def _fit_y_visible(self):
        try:
            if not self.payload:
                return
            ohlc = self.payload.get("ohlc") or {}
            t = ohlc.get("t") or []
            h = ohlc.get("h") or []
            l = ohlc.get("l") or []
            if not t:
                return
            vr = self.candle_plot.plotItem.vb.viewRange()
            x0, x1 = vr[0]
            idxs = [i for i, xv in enumerate(t) if x0 <= float(xv) <= x1]
            if not idxs:
                return
            lo = min(float(l[i]) for i in idxs)
            hi = max(float(h[i]) for i in idxs)
            pad = (hi - lo) * 0.08 if hi > lo else max(1.0, hi*0.002)
            self.candle_plot.setYRange(lo-pad, hi+pad, padding=0)
        except Exception:
            pass

    def _on_mouse_move(self, evt):
        pos = evt[0]
        if self.candle_plot.sceneBoundingRect().contains(pos):
            mp = self.candle_plot.plotItem.vb.mapSceneToView(pos)
            self.vline.setPos(mp.x())
            self.hline.setPos(mp.y())
            # show hover candle & nearby levels
            self._update_hover(mp.x(), mp.y())

    def _update_hover(self, x: float, y: float):
        try:
            if not self.payload:
                return
            ohlc = self.payload.get("ohlc") or {}
            t = ohlc.get("t") or []
            if not t:
                return
            # nearest candle by time
            arr = np.array(t, dtype=float)
            i = int(np.argmin(np.abs(arr - float(x))))
            o = float((ohlc.get("o") or [0])[i])
            c = float((ohlc.get("c") or [0])[i])
            h = float((ohlc.get("h") or [0])[i])
            l = float((ohlc.get("l") or [0])[i])
            hint = f"O:{o:.1f} H:{h:.1f} L:{l:.1f} C:{c:.1f}"
            # nearest level
            spot = float(self.payload.get("spot") or 0.0)
            levels = []
            if self.flip:
                levels.append(("FLIP", float(self.flip)))
            for s, _ in (self.walls or []):
                levels.append(("WALL", float(s)))
            if levels:
                name, lv = min(levels, key=lambda kv: abs(kv[1]-y))
                if abs(lv - y) <= max(spot*0.003, 140.0):
                    hint += f" | near {name} {lv:,.0f}"
            self.lbl_hover.setText(hint)
        except Exception:
            pass

    def _on_candle_click(self, event):
        if not self.payload:
            return
        pos = event.scenePos()
        if not self.candle_plot.sceneBoundingRect().contains(pos):
            return
        mp = self.candle_plot.plotItem.vb.mapSceneToView(pos)
        y = float(mp.y())
        spot = float(self.payload.get("spot") or 0.0)

        # choose nearest wall/flip based on y
        candidates = []
        if self.flip is not None:
            candidates.append(("FLIP", float(self.flip)))
        for s, net in (self.walls or []):
            candidates.append(("WALL", float(s)))
        if not candidates:
            return
        name, lv = min(candidates, key=lambda kv: abs(kv[1]-y))
        tol = max(spot*0.004, 180.0)
        if abs(lv - y) <= tol:
            self.selected_level = lv
            # snap to strike for options lookup
            self.selected_strike = lv
            self._update_selection_cards(source=name)
            self._highlight_level(lv)

    def _on_gex_click(self, event):
        if not self.strike_net:
            return
        pos = event.scenePos()
        if not self.gex_plot.sceneBoundingRect().contains(pos):
            return
        mp = self.gex_plot.plotItem.vb.mapSceneToView(pos)
        x = float(mp.x())

        strikes = np.array(list(self.strike_net.keys()), dtype=float)
        if strikes.size == 0:
            return
        i = int(np.argmin(np.abs(strikes - x)))
        sel = float(strikes[i])
        self.selected_strike = sel
        self.selected_level = sel
        self._update_selection_cards(source="GEX")
        self._highlight_level(sel)

    def _highlight_level(self, lv: float):
        try:
            if self._selected_line is not None:
                self.candle_plot.removeItem(self._selected_line)
        except Exception:
            pass
        self._selected_line = pg.InfiniteLine(pos=lv, angle=0, movable=False, pen=pg.mkPen("#ffb020", width=2))
        self.candle_plot.addItem(self._selected_line, ignoreBounds=True)

    # ---------------- Data fetch & refresh ----------------
    def refresh_all(self):
        self._last_refresh = time.time()
        self.lbl_status.setText("Atualizando...")
        self._on_cfg_change()
        QtCore.QTimer.singleShot(10, self._refresh_worker)

    def _refresh_worker(self):
        try:
            t0 = time.time()
            payload = self._fetch_test() if self.mode == "TEST" else self._fetch_live()
            self._last_latency_ms = (time.time() - t0) * 1000.0
            self.payload = payload

            self.lbl_last.setText(f"Última: {now_str()}")
            self.lbl_lat.setText(f"Lat: {self._last_latency_ms:.0f} ms")
            self.lbl_status.setText("OK")

            self._update_cards()
            self._paint_candles(payload["ohlc"])
            self._paint_gex()
            self._paint_options()

            if self.selected_level is not None:
                self._update_selection_cards(source="KEEP")

            # auto-fit y if enabled
            if self.cb_autoy.currentText().endswith("ON"):
                self._fit_y_visible()

            log(f"Refresh OK mode={self.mode} inst={self.instrument} tf={self.tf} scope={self.gex_scope} latency={self._last_latency_ms:.0f}ms")
        except Exception as e:
            crash(e)
            self.lbl_status.setText(f"ERRO ({e}) -> TEST")
            try:
                payload = self._fetch_test()
                self.mode = "TEST"
                self.cb_mode.setCurrentText("TEST")
                self.payload = payload
                self.lbl_last.setText(f"Última: {now_str()}")
                self._update_cards()
                self._paint_candles(payload["ohlc"])
                self._paint_gex()
                self._paint_options()
            except Exception as e2:
                crash(e2)

    def _fetch_test(self):
        step = 60 if self.tf in ("1","5","15") else (60*60 if self.tf in ("60",) else (4*60*60 if self.tf in ("240",) else 24*60*60))
        n = int(getattr(self, "candles_n", 900) or 900)
        ohlc = gen_ohlc(n=n, start_price=70000.0 if "BTC" in self.instrument else 3500.0, step_sec=step)
        spot = float(ohlc["c"][-1])
        raw_chain = gen_options_chain(spot=spot, center_strike=int(round(spot/1000)*1000))
        rows = compute_gex_rows(raw_chain, scale=1e-6)
        self.rows = rows
        self.strike_net = aggregate_by_strike(rows)
        self.flip = gamma_flip(self.strike_net)
        self.walls = top_walls(self.strike_net, n=14)
        self._last_chain_ts = time.time()
        return {"mode":"TEST","ohlc":ohlc,"spot":spot}

    def _fetch_live(self):
        inst = self.instrument
        tf = self.tf

        now_ms = int(time.time() * 1000)
        # Candle history span is user-controlled (candles_n)
        n = int(getattr(self, "candles_n", 900) or 900)
        tf_sec = 60
        if tf == "1": tf_sec = 60
        elif tf == "5": tf_sec = 5 * 60
        elif tf == "15": tf_sec = 15 * 60
        elif tf == "60": tf_sec = 60 * 60
        elif tf == "240": tf_sec = 4 * 60 * 60
        else: tf_sec = 24 * 60 * 60  # 1D

        span = n * tf_sec * 1000
        start_ms = now_ms - span

        chart, _ = self.client.get_tradingview_chart_data(inst, tf, start_ms, now_ms)
        t = chart.get("ticks") or chart.get("t") or []
        o = chart.get("open") or chart.get("o") or []
        h = chart.get("high") or chart.get("h") or []
        l = chart.get("low") or chart.get("l") or []
        c = chart.get("close") or chart.get("c") or []
        v = chart.get("volume") or chart.get("v") or []
        # Normalize timestamps: Deribit returns milliseconds; DateAxisItem expects seconds.
        try:
            if t and float(t[-1]) > 1e11:
                t = [float(x) / 1000.0 for x in t]
        except Exception:
            pass
        ohlc = {"t":t,"o":o,"h":h,"l":l,"c":c,"v":v}

        ticker, _ = self.client.get_ticker(inst)
        spot = float(ticker.get("last_price") or ticker.get("index_price") or (c[-1] if c else 0.0) or 0.0)

        # Chain heavy part with caching
        if time.time() - self._last_chain_ts >= float(self.chain_refresh_sec) or not self.rows:
            currency = "BTC" if "BTC" in inst else "ETH"
            insts, _ = self.client.get_instruments(currency=currency, kind="option", expired=False)

            expiries = sorted({i.get("expiration_timestamp") for i in insts if i.get("expiration_timestamp")})
            target_exp = expiries[0] if expiries else None

            # window
            pct = float(self.gex_window_pct)
            candidates = []
            for it in insts:
                name = it.get("instrument_name")
                if not name:
                    continue
                if target_exp and it.get("expiration_timestamp") != target_exp:
                    continue
                strike = float(it.get("strike") or 0.0)
                if strike <= 0:
                    continue
                if abs(strike - spot) / max(spot,1.0) > pct:
                    continue
                candidates.append(it)

            # keep more instruments (scope)
            candidates = sorted(candidates, key=lambda x: abs(float(x.get("strike") or 0.0) - spot))[:int(self.gex_max_instruments)]

            raw_chain: List[Dict[str, Any]] = []

            def fetch_one(it):
                name = it["instrument_name"]
                tick, _ = self.client.get_ticker(name)
                greeks = tick.get("greeks") or {}
                parts = name.split("-")
                expiry_code = parts[1] if len(parts) >= 3 else ""
                return {
                    "instrument_name": name,
                    "strike": float(it.get("strike") or 0.0),
                    "option_type": "call" if str(it.get("option_type","")).lower().startswith("c") else "put",
                    "open_interest": float(tick.get("open_interest") or 0.0),
                    "gamma": float(greeks.get("gamma") or 0.0),
                    "bid_price": float(tick.get("best_bid_price") or 0.0),
                    "ask_price": float(tick.get("best_ask_price") or 0.0),
                    "mark_iv": float(tick.get("mark_iv") or 0.0),
                    "underlying_price": float(spot),
                    "expiry": expiry_code,
                }

            workers = 14 if self.gex_scope != "ULTRA" else 18
            timeout = 16 if self.gex_scope != "ULTRA" else 24
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(fetch_one, it) for it in candidates]
                for f in as_completed(futs, timeout=timeout):
                    try:
                        raw_chain.append(f.result())
                    except Exception:
                        pass

            rows = compute_gex_rows(raw_chain, scale=1e-6)
            self.rows = rows
            self.strike_net = aggregate_by_strike(rows)
            self.flip = gamma_flip(self.strike_net)
            self.walls = top_walls(self.strike_net, n=16)
            self._last_chain_ts = time.time()

        return {"mode":"LIVE","ohlc":ohlc,"spot":spot}

    def _auto_loop(self):
        if self.mode == "LIVE":
            if time.time() - self._last_refresh >= float(self.auto_sec):
                self.refresh_all()

    def _on_tab_changed(self, idx: int):
        try:
            name = self.tabs.tabText(idx)
        except Exception:
            return
        if name == "Altcoins":
            if self.alt_last is None:
                self.refresh_altcoins()
        elif name == "News":
            if not self.news_items:
                self.refresh_news()

    # ---------------- Paint ----------------
    def _paint_candles(self, ohlc: Dict[str, Any]):
        t = ohlc.get("t") or []
        o = ohlc.get("o") or []
        h = ohlc.get("h") or []
        l = ohlc.get("l") or []
        c = ohlc.get("c") or []
        data = []
        for i in range(min(len(t), len(o), len(c), len(l), len(h))):
            # Deribit chart timestamps usually come in milliseconds.
            x = float(t[i])
            if x > 1e11:
                x = x / 1000.0
            data.append((x, float(o[i]), float(c[i]), float(l[i]), float(h[i])))
        self.candle_item.setData(data)

        # keep some padding on x
        if data:
            xs = [d[0] for d in data]
            self.candle_plot.setXRange(min(xs), max(xs), padding=0.02)

        # rebuild level lines
        self._paint_levels()

    def _paint_levels(self):
        # remove old lines
        for ln in self._level_lines:
            try:
                self.candle_plot.removeItem(ln)
            except Exception:
                pass
        self._level_lines = []

        if not self.payload:
            return

        # walls
        for strike, net in (self.walls or []):
            w = 2 if abs(net) >= 80 else 1
            col = "#2c7dff"
            ln = pg.InfiniteLine(pos=float(strike), angle=0, movable=False, pen=pg.mkPen(col, width=w))
            self.candle_plot.addItem(ln, ignoreBounds=True)
            self._level_lines.append(ln)

        # flip
        if self.flip is not None:
            ln = pg.InfiniteLine(pos=float(self.flip), angle=0, movable=False, pen=pg.mkPen("#b16cff", width=2))
            self.candle_plot.addItem(ln, ignoreBounds=True)
            self._level_lines.append(ln)

    def _paint_gex(self):
        self.gex_plot.clear()
        self.gex_bars = None
        if not self.strike_net:
            return

        strikes = np.array(list(self.strike_net.keys()), dtype=float)
        vals = np.array([self.strike_net[s] for s in strikes], dtype=float)

        # bar graph
        bg = pg.BarGraphItem(x=strikes, height=vals, width=0.8*(np.min(np.diff(np.sort(strikes))) if len(strikes)>1 else 100.0), brush=pg.mkBrush("#2c7dff"))
        self.gex_plot.addItem(bg)
        self.gex_bars = bg
        self.gex_plot.addLine(y=0, pen=pg.mkPen("#4b5563", width=1))

        # show wider x-range with padding
        x0, x1 = float(np.min(strikes)), float(np.max(strikes))
        pad = (x1 - x0) * 0.10 if x1 > x0 else max(500.0, x0*0.05)
        self.gex_plot.setXRange(x0 - pad, x1 + pad, padding=0)

    def _paint_options(self):
        filt = self.cb_filter.currentText()
        rows = self.rows or []
        if filt == "CALL":
            rows = [r for r in rows if r.option_type == "call"]
        elif filt == "PUT":
            rows = [r for r in rows if r.option_type == "put"]

        # sort
        rows = sorted(rows, key=lambda r: (r.strike, r.option_type))
        self.tbl_opt.setRowCount(len(rows))
        exp_any = None
        for i, r in enumerate(rows):
            exp = getattr(r, "expiry", "") or ""
            if exp and exp_any is None:
                exp_any = exp
            dte = days_to_expiry(exp) if exp else None
            cells = [
                r.instrument_name, r.option_type, f"{r.strike:,.0f}",
                exp or "—", str(dte) if dte is not None else "—",
                fmt_num(r.open_interest,0), fmt_num(r.gamma,6), fmt_num(r.gex,2),
                fmt_num(r.bid_price,4), fmt_num(r.ask_price,4), fmt_num(r.mark_iv,2)
            ]
            for j, v in enumerate(cells):
                it = QtWidgets.QTableWidgetItem(str(v))
                self.tbl_opt.setItem(i, j, it)

        if exp_any:
            dte = days_to_expiry(exp_any)
            self.lbl_exp.setText(f"Expiry: {exp_any} | DTE: {dte if dte is not None else '—'}")
        else:
            self.lbl_exp.setText("Expiry: —")

    def _paint_news(self):
        cat = self.cb_news.currentText()
        q = (self.ed_news.text() or "").strip().lower()

        items = self.news_items[:]
        if cat != "ALL":
            # feed category is embedded in source label prefix
            if cat == "Crypto":
                items = [it for it in items if "crypto" in it.source.lower() or "google: crypto" in it.source.lower() or "bitcoin" in it.source.lower()]
            else:
                items = [it for it in items if "fed" in it.source.lower() or "cpi" in it.source.lower() or "risk" in it.source.lower()]

        if q:
            items = [it for it in items if q in it.title.lower() or q in it.assets.lower()]

        items = sorted(items, key=lambda it: it.score, reverse=True)[:80]
        self.tbl_news.setRowCount(len(items))
        for i, it in enumerate(items):
            cells = [str(it.score), it.assets, it.source, it.title, it.link]
            for j, v in enumerate(cells):
                cell = QtWidgets.QTableWidgetItem(str(v))
                if j == 0:
                    cell.setTextAlignment(QtCore.Qt.AlignCenter)
                self.tbl_news.setItem(i, j, cell)
        self.lbl_news.setText(f"{len(items)} itens")

    # ---------------- Cards update ----------------
    def _update_cards(self):
        if not self.payload:
            return
        spot = float(self.payload.get("spot") or 0.0)
        reg = regime_text(self.strike_net, self.flip)
        self.k_spot.setText(fmt_num(spot, 2))
        self.k_reg.setText(f"{reg} | {self.instrument} TF={self.tf} ({self.mode})")

        # net gex proxy
        net = sum(self.strike_net.values()) if self.strike_net else 0.0
        self.k_net.setText(fmt_num(net, 2))
        self.k_flip.setText(f"Flip: {fmt_num(self.flip,0) if self.flip else '—'}")

        below, above = self._nearest_walls(spot)
        self.k_wall.setText(f"Below: {below if below else '—'} | Above: {above if above else '—'}")

        # build_action_context signature (src/strategy.py): (spot, regime, flip, walls)
        ctx = build_action_context(spot=spot, regime=reg, flip=self.flip, walls=self.walls)
        self.k_action.setText(ctx.get("action_text","—"))

        self.k_health.setText(f"Mode: {self.mode}\nLatency: {self._last_latency_ms:.0f} ms\nScope: {self.gex_scope} (±{int(self.gex_window_pct*100)}%)")

        # context text
        top_lines = []
        top_lines.append(f"Spot: {fmt_num(spot,2)}")
        top_lines.append(f"Regime: {reg}")
        if self.flip:
            top_lines.append(f"Flip: {fmt_num(self.flip,0)}")
        top_lines.append("")
        top_lines.append("Top walls (abs net):")
        for s, netv in (self.walls or [])[:10]:
            top_lines.append(f"  {s:,.0f} | net={netv:.2f} | dist={s-spot:+.0f}")
        self.ctx_text.setPlainText("\n".join(top_lines))

    def _nearest_walls(self, spot: float) -> Tuple[Optional[str], Optional[str]]:
        if not self.walls:
            return None, None
        strikes = sorted([float(s) for s,_ in self.walls])
        below = max([s for s in strikes if s <= spot], default=None)
        above = min([s for s in strikes if s >= spot], default=None)
        return (f"{below:,.0f}" if below is not None else None, f"{above:,.0f}" if above is not None else None)

    def _update_selection_cards(self, source: str = "GEX"):
        if not self.payload:
            return
        spot = float(self.payload.get("spot") or 0.0)
        lv = float(self.selected_level) if self.selected_level is not None else None
        if lv is None:
            return

        net_here = float(self.strike_net.get(lv, 0.0)) if self.strike_net else 0.0
        reg = regime_text(self.strike_net, self.flip)
        below, above = self._nearest_walls(spot)

        # Level details (include top options)
        lines = []
        lines.append(f"Source: {source}")
        lines.append(f"Level/Strike: {lv:,.0f} (WALL/FLIP/GEX)")
        lines.append(f"Net GEX@level: {net_here:.2f}")
        lines.append(f"Distance to spot: {lv-spot:+.0f}")
        lines.append(f"Regime: {reg}")
        if self.flip:
            lines.append(f"Flip: {fmt_num(self.flip,0)}")
        lines.append(f"Nearest walls: below {below or '—'} | above {above or '—'}")
        lines.append("")
        lines.append("Top options (by |gex|) at this strike:")

        opts = [r for r in (self.rows or []) if abs(r.strike - lv) < 1e-6]
        opts = sorted(opts, key=lambda r: abs(r.gex), reverse=True)[:6]
        self.tbl_sug.setRowCount(len(opts))
        for i, r in enumerate(opts):
            dte = days_to_expiry(getattr(r,"expiry","") or "")
            lines.append(f"  - {r.instrument_name} ({r.option_type}) gex={r.gex:.2f} bid/ask={r.bid_price:.4f}/{r.ask_price:.4f} oi={r.open_interest:.0f} expiry={getattr(r,'expiry','')} dte={dte}")
            cells = [
                r.instrument_name, r.option_type, f"{r.strike:,.0f}",
                getattr(r,"expiry","") or "—",
                str(dte) if dte is not None else "—",
                fmt_num(r.gex,2), fmt_num(r.bid_price,4), fmt_num(r.ask_price,4), fmt_num(r.open_interest,0)
            ]
            for j, v in enumerate(cells):
                self.tbl_sug.setItem(i, j, QtWidgets.QTableWidgetItem(str(v)))

        if not opts:
            self.tbl_sug.setRowCount(0)
            lines.append("  (no options loaded for this strike yet)")

        self.level_text.setPlainText("\n".join(lines))

        # Strategy (use existing planner)
        plan = plan_from_selected_level(spot=spot, level=lv, regime=reg, flip=self.flip, nearest_below=below, nearest_above=above)
        self.strategy_text.setPlainText(self._render_plan(plan))

    # ---------------- Trade planner ----------------
    def _autofill_plan(self):
        if not self.payload or self.selected_level is None:
            return
        spot = float(self.payload.get("spot") or 0.0)
        lv = float(self.selected_level)
        # heuristic: target back to spot or to nearest wall
        below, above = self._nearest_walls(spot)
        try:
            nb = float(below.replace(",","")) if below else None
            na = float(above.replace(",","")) if above else None
        except Exception:
            nb = na = None

        if lv >= spot:
            entry = spot
            stop = spot - max(spot*0.003, 120)
            target = lv
        else:
            entry = spot
            stop = spot + max(spot*0.003, 120)
            target = lv

        self.ed_entry.setText(f"{entry:.2f}")
        self.ed_stop.setText(f"{stop:.2f}")
        self.ed_target.setText(f"{target:.2f}")
        self._calc_rr()

    def _calc_rr(self):
        try:
            e = float(self.ed_entry.text())
            s = float(self.ed_stop.text())
            t = float(self.ed_target.text())
            risk = abs(e - s)
            rew = abs(t - e)
            rr = (rew / risk) if risk > 0 else 0.0
            self.lbl_rr.setText(f"RR: {rr:.2f} | risk={risk:.2f} reward={rew:.2f}")
        except Exception:
            self.lbl_rr.setText("RR: —")

    # ---------------- Altcoins ----------------
    def refresh_altcoins(self):
        self.alt_exchange = self.cb_alt_ex.currentText()
        self.alt_symbol = self.cb_alt_sym.currentText()
        self.alt_tf = self.cb_alt_tf.currentText()
        self.lbl_alt.setText("Atualizando...")
        QtCore.QTimer.singleShot(10, self._alt_worker)

    def _alt_worker(self):
        try:
            sym = self.alt_symbol
            tf = self.alt_tf
            lim = int(getattr(self, 'sp_alt_candles', None).value()) if hasattr(self, 'sp_alt_candles') else 900
            lim = max(120, min(3000, int(lim)))
            if self.alt_exchange == "Binance":
                ohlc = binance_klines(sym, tf, limit=lim)
                tick = binance_ticker(sym)
                last = float(tick.get("lastPrice") or 0.0)
                chg = float(tick.get("priceChangePercent") or 0.0)
                vol = float(tick.get("quoteVolume") or 0.0)
            else:
                ohlc = bybit_klines(sym, tf, limit=lim)
                last = float(ohlc[-1][2]) if ohlc else 0.0
                chg = 0.0
                vol = 0.0

            if not ohlc:
                self.alt_item.setData([])
                self.lbl_alt.setText(f"SEM DADOS ({self.alt_exchange}) | {now_str()}")
                self.alt_ctx.setPlainText(f"Sem OHLC para {sym} ({self.alt_exchange}) em {tf}.\n\n- Tente trocar o exchange (Binance/Bybit)\n- Tente TF menor\n- Verifique conexão/limites de API")
                return

            # paint
            data = [(float(ts), float(o), float(c), float(l), float(h)) for (ts,o,c,l,h,v) in ohlc]
            self.alt_item.setData(data)
            if data:
                xs = [d[0] for d in data]
                self.alt_plot.setXRange(min(xs), max(xs), padding=0.02)

            meta = ALT_META.get(sym, {"name":sym, "sector":"—", "launch":"—"})
            self.alt_ctx.setPlainText(
                f"Symbol: {sym} ({self.alt_exchange})\n"
                f"Last: {last:,.6f}\n"
                f"24h%: {chg:.2f}%\n"
                f"QuoteVol: {vol:,.0f}\n"
                f"TF: {tf}\n"
            )
            self.alt_life.setPlainText(
                f"Name: {meta.get('name','—')}\n"
                f"Sector: {meta.get('sector','—')}\n"
                f"Launch: {meta.get('launch','—')}\n\n"
                f"Notas:\n"
                f"- Você pode expandir metadata integrando CoinGecko (vamos fazer no próximo passo, com cache e rate-limit).\n"
                f"- Estratégia de execução: priorize liquidez e valide spread (principalmente em altcoins menores).\n"
            )
            # basic action
            self.alt_signals.setPlainText(
                "Checklist rápido (altcoins):\n"
                "1) Liquidez/Spread OK?\n"
                "2) Notícia relevante hoje? (veja a aba News)\n"
                "3) Direção do BTC/ETH ajudando ou atrapalhando?\n"
                "4) Níveis (suportes/resistências) no TF maior.\n"
            )
            self.lbl_alt.setText(f"OK | {now_str()}")
        except Exception as e:
            crash(e)
            self.lbl_alt.setText(f"ERRO: {e}")

    # ---------------- News ----------------
    def _load_altcoins_list(self):
        """Load a full symbol list (best-effort)."""
        try:
            ex = self.cb_alt_ex.currentText()
            self.lbl_alt.setText("Carregando lista...")
            syms: List[str] = []
            if ex == "Binance":
                syms = binance_usdt_symbols(force=True)
            else:
                # TODO: implementar lista completa da Bybit (endpoint instruments). Por enquanto, usa a lista padrão.
                syms = list(ALTCOINS_DEFAULT)

            if not syms:
                self.lbl_alt.setText("Lista vazia")
                return

            self._alt_all_symbols = list(syms)
            cur = self.cb_alt_sym.currentText()
            self.cb_alt_sym.blockSignals(True)
            self.cb_alt_sym.clear()
            self.cb_alt_sym.addItems(self._alt_all_symbols)
            if cur in self._alt_all_symbols:
                self.cb_alt_sym.setCurrentText(cur)
            self.cb_alt_sym.blockSignals(False)

            self.lbl_alt.setText(f"Lista OK ({len(self._alt_all_symbols)})")
        except Exception as e:
            crash(e)
            self.lbl_alt.setText(f"ERRO lista: {e}")

    def _filter_altcoins_combo(self, txt: str):
        try:
            q = (txt or "").strip().upper()
            if not q:
                syms = list(self._alt_all_symbols)
            else:
                syms = [s for s in (self._alt_all_symbols or []) if q in s]

            cur = self.cb_alt_sym.currentText()
            self.cb_alt_sym.blockSignals(True)
            self.cb_alt_sym.clear()
            self.cb_alt_sym.addItems(syms[:2000])
            if cur in syms:
                self.cb_alt_sym.setCurrentText(cur)
            self.cb_alt_sym.blockSignals(False)
        except Exception:
            pass

    def refresh_news(self):
        self.lbl_news.setText("Atualizando...")
        QtCore.QTimer.singleShot(10, self._news_worker)

    def _news_worker(self):
        try:
            items: List[NewsItem] = []
            for cat, name, url in NEWS_FEEDS:
                got = fetch_rss_items(url)
                for it in got:
                    it.source = f"{cat} | {name}"
                items.extend(got)
            # de-dup by title
            seen = set()
            uniq = []
            for it in items:
                key = it.title.lower().strip()
                if key and key not in seen:
                    seen.add(key)
                    uniq.append(it)
            self.news_items = uniq
            if not self.news_items:
                self.tbl_news.setRowCount(0)
                self.lbl_news.setText(f"SEM NOTÍCIAS | {now_str()}")
                return
            self._paint_news()
            self.lbl_news.setText(f"OK ({len(self.news_items)}) | {now_str()}")
        except Exception as e:
            crash(e)
            self.lbl_news.setText(f"ERRO: {e}")

    def _open_news_link(self, row: int, col: int):
        try:
            link_item = self.tbl_news.item(row, 4)
            if not link_item:
                return
            url = link_item.text().strip()
            if not url:
                return
            QtGui.QDesktopServices.openUrl(QtCore.QUrl(url))
        except Exception:
            pass

    # ---------------- Logs ----------------
    def _reload_logs(self):
        try:
            from pathlib import Path
            p = Path("logs/app.log")
            txt = p.read_text(encoding="utf-8") if p.exists() else "(sem logs ainda)"
            self.log_box.setPlainText(txt[-12000:])
        except Exception as e:
            self.log_box.setPlainText(str(e))


def main():
    try:
        app = QtWidgets.QApplication([])
        pg.setConfigOptions(antialias=True)
        w = DeskWindow()
        w.show()
        app.exec()
    except Exception as e:
        crash(e)
        raise
