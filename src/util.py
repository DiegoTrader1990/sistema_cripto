from __future__ import annotations

"""
util.py — shared utilities (logging, crash reporting, small helpers)

PATCH v2.0 (Mesa Operacional)
- Structured logging with levels (INFO/WARN/ERROR)
- More informative crash logs with context + traceback
- Optional JSON status snapshot (useful for UI health cards)
- Backwards compatible: keep `log(msg)` and `crash(e)` APIs
"""

import json
import os
import traceback
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, Optional

# ---------------- Logging ----------------

LOG_DIR = os.environ.get("MESA_LOG_DIR", "logs")
APP_LOG = "app.log"
CRASH_LOG = "crash.log"
STATUS_JSON = "status.json"


def ensure_logs() -> None:
    os.makedirs(LOG_DIR, exist_ok=True)


def now_str() -> str:
    # local time (UI is local)
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _write_line(filename: str, line: str) -> None:
    ensure_logs()
    path = os.path.join(LOG_DIR, filename)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def log(msg: str) -> None:
    """Backwards compatible: INFO log line."""
    log_info(msg)


def log_info(msg: str, *, module: str = "app") -> None:
    _write_line(APP_LOG, f"[{now_str()}] [INFO] [{module}] {msg}")


def log_warn(msg: str, *, module: str = "app") -> None:
    _write_line(APP_LOG, f"[{now_str()}] [WARN] [{module}] {msg}")


def log_error(msg: str, *, module: str = "app") -> None:
    _write_line(APP_LOG, f"[{now_str()}] [ERROR] [{module}] {msg}")


def crash(e: BaseException) -> None:
    """Backwards compatible: write traceback to crash.log."""
    log_exception("Unhandled exception", e=e, module="app")


def log_exception(msg: str, *, e: BaseException, module: str = "app", context: Optional[Dict[str, Any]] = None) -> None:
    ensure_logs()
    # human log
    log_error(f"{msg}: {type(e).__name__}: {e}", module=module)

    # crash log (full traceback + context)
    header = {
        "ts": now_str(),
        "module": module,
        "message": msg,
        "exc_type": type(e).__name__,
        "exc": str(e),
        "context": context or {},
    }
    path = os.path.join(LOG_DIR, CRASH_LOG)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(header, ensure_ascii=False) + "\n")
        f.write(traceback.format_exc())
        f.write("\n\n")


def safe_call(fn: Callable[[], Any], *, default: Any = None, module: str = "app", context: Optional[Dict[str, Any]] = None) -> Any:
    """
    Execute a function safely. If it raises, log and return default.
    Useful for UI polling loops: never crash the UI thread.
    """
    try:
        return fn()
    except Exception as e:
        log_exception("safe_call failed", e=e, module=module, context=context)
        return default


# ---------------- Status snapshot (optional) ----------------

@dataclass
class ModuleStatus:
    ok: bool
    detail: str = ""
    ts: str = ""


_STATUS: Dict[str, ModuleStatus] = {}


def set_status(key: str, ok: bool, detail: str = "") -> None:
    """
    Store a module status in memory and persist to logs/status.json.
    This is optional but helps to diagnose 'aba vazia' situations.
    """
    st = ModuleStatus(ok=bool(ok), detail=str(detail)[:500], ts=now_str())
    _STATUS[key] = st
    _persist_status()


def get_status(key: str) -> Optional[ModuleStatus]:
    return _STATUS.get(key)


def _persist_status() -> None:
    try:
        ensure_logs()
        payload = {k: {"ok": v.ok, "detail": v.detail, "ts": v.ts} for k, v in _STATUS.items()}
        tmp = os.path.join(LOG_DIR, STATUS_JSON + ".tmp")
        out = os.path.join(LOG_DIR, STATUS_JSON)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        # atomic replace on Windows is fine with os.replace
        os.replace(tmp, out)
    except Exception:
        # Do not recurse to log_exception here — keep it silent
        pass


# ---------------- Expiry parsing (Deribit instrument codes) ----------------
# Accepts strings like '9FEB26', '28MAR25', etc.

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def parse_deribit_expiry(code: str) -> datetime | None:
    try:
        s = str(code).strip().upper()
        if not s:
            return None
        # day may be 1 or 2 digits: 9FEB26 or 28MAR25
        mpos = None
        for i in range(1, 3):
            if len(s) >= i + 3:
                mon = s[i:i + 3]
                if mon in _MONTHS:
                    mpos = i
                    break
        if mpos is None:
            return None
        day = int(s[:mpos])
        mon = _MONTHS[s[mpos:mpos + 3]]
        year = int(s[mpos + 3:])
        year += 2000 if year < 100 else 0
        # Deribit expiry is usually 08:00 UTC; for DTE we only need date
        return datetime(year, mon, day)
    except Exception:
        return None


def days_to_expiry(code: str) -> int | None:
    dt = parse_deribit_expiry(code)
    if dt is None:
        return None
    # Use UTC date to avoid timezone confusion
    return int((dt.date() - datetime.utcnow().date()).days)
