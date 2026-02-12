from __future__ import annotations
import math, random, time

def gen_ohlc(n: int = 320, start_price: float = 50000.0, step_sec: int = 60):
    t0 = int(time.time()) - n * step_sec
    times, o, h, l, c, v = [], [], [], [], [], []
    price = start_price
    for i in range(n):
        times.append((t0 + i * step_sec) * 1000)  # ms
        op = price
        drift = (math.sin(i / 13.0) * 12.0) + random.uniform(-55, 55)
        cl = max(100.0, op + drift)
        hi = max(op, cl) + random.uniform(10, 80)
        lo = min(op, cl) - random.uniform(10, 80)
        vol = random.uniform(10, 280)
        o.append(op); h.append(hi); l.append(lo); c.append(cl); v.append(vol)
        price = cl
    return {"t": times, "o": o, "h": h, "l": l, "c": c, "v": v}

def gen_options_chain(spot: float = 50000.0, center_strike: int = 50000):
    strikes = [center_strike + i * 1000 for i in range(-18, 19)]
    rows = []
    for k in strikes:
        for opt_type in ("C", "P"):
            gamma = max(1e-10, abs(random.gauss(1.3e-6, 6e-7)))
            oi = max(1.0, abs(random.gauss(1200, 650)))
            bid = max(0.5, abs(random.gauss(60, 28)))
            ask = bid + random.uniform(0.5, 5.0)
            iv = max(0.05, abs(random.gauss(0.65, 0.14)))
            rows.append({
                "instrument_name": f"BTC-TEST-{k}-{opt_type}",
                "strike": float(k),
                "option_type": "call" if opt_type == "C" else "put",
                "open_interest": float(oi),
                "gamma": float(gamma),
                "bid_price": float(bid),
                "ask_price": float(ask),
                "mark_iv": float(iv),
                "underlying_price": float(spot),
                "expiry": "TEST",
            })
    return rows
