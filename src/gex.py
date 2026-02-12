from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, Any, List, Tuple, Optional

@dataclass
class GexRow:
    instrument_name: str
    strike: float
    option_type: str
    open_interest: float
    gamma: float
    bid_price: float
    ask_price: float
    mark_iv: float
    underlying_price: float
    expiry: str
    gex: float

def compute_gex_rows(raw_rows: List[Dict[str, Any]], scale: float = 1.0) -> List[GexRow]:
    out: List[GexRow] = []
    for r in raw_rows:
        strike = float(r.get("strike", 0.0))
        option_type = str(r.get("option_type", ""))
        oi = float(r.get("open_interest", 0.0))
        gamma = float(r.get("gamma", 0.0))
        bid = float(r.get("bid_price", 0.0))
        ask = float(r.get("ask_price", 0.0))
        iv = float(r.get("mark_iv", 0.0))
        spot = float(r.get("underlying_price", 0.0))
        expiry = str(r.get("expiry", ""))
        sign = 1.0 if option_type == "call" else -1.0
        gex = sign * gamma * oi * (spot ** 2) * scale
        out.append(GexRow(
            instrument_name=str(r.get("instrument_name","")),
            strike=strike, option_type=option_type,
            open_interest=oi, gamma=gamma,
            bid_price=bid, ask_price=ask,
            mark_iv=iv, underlying_price=spot,
            expiry=expiry, gex=gex
        ))
    return out

def aggregate_by_strike(rows: List[GexRow]) -> Dict[float, float]:
    d: Dict[float, float] = {}
    for r in rows:
        d[r.strike] = d.get(r.strike, 0.0) + r.gex
    return dict(sorted(d.items(), key=lambda x: x[0]))

def gamma_flip(strike_net: Dict[float, float]) -> Optional[float]:
    cum = 0.0
    prev = None
    for k, v in strike_net.items():
        cum += v
        if prev is not None and ((prev <= 0.0 and cum >= 0.0) or (prev >= 0.0 and cum <= 0.0)):
            return float(k)
        prev = cum
    return None

def top_walls(strike_net: Dict[float, float], n: int = 12) -> List[Tuple[float, float]]:
    items = list(strike_net.items())
    items.sort(key=lambda kv: abs(kv[1]), reverse=True)
    return items[:n]

def regime_text(strike_net: Dict[float,float], flip: float = None) -> str:
    net_total = sum(strike_net.values()) if strike_net else 0.0
    if net_total > 0: return "GAMMA+ (mean-revert)"
    if net_total < 0: return "GAMMA- (direcional)"
    return "NEUTRO"
