from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple, Union


@dataclass
class Plan:
    setup: str
    bias: str
    entry: float
    stop: float
    target: float
    rr: float
    rationale: str


def _nearest_levels_from_walls(spot: float, walls: Optional[List[Tuple[float, float]]]) -> Tuple[Optional[float], Optional[float]]:
    levels: List[float] = []
    for k, _ in (walls or []):
        try:
            levels.append(float(k))
        except Exception:
            pass
    below = max([x for x in levels if x <= spot], default=None)
    above = min([x for x in levels if x >= spot], default=None)
    return below, above


def build_action_context(
    spot: float,
    regime: str,
    flip: Optional[float],
    walls: Optional[List[Tuple[float, float]]],
) -> Dict[str, Any]:
    """
    UI-friendly helper.

    Returns a dict (NOT a tuple):
      {
        "action_text": str,
        "below": Optional[float],
        "above": Optional[float],
        "watch": List[str]
      }
    """
    below, above = _nearest_levels_from_walls(spot, walls)
    watch: List[str] = []
    if below is not None:
        watch.append(f"below {below:,.0f}")
    if above is not None:
        watch.append(f"above {above:,.0f}")
    if flip is not None:
        try:
            watch.append(f"flip {float(flip):,.0f}")
        except Exception:
            watch.append("flip —")

    watch_s = ", ".join(watch) if watch else "no key levels"

    reg_u = (regime or "").upper()
    if "GAMMA+" in reg_u:
        action_text = (
            "Gamma+ → procurar rejeição (fade) em walls; "
            f"evitar perseguir rompimento sem confirmação. Watch: {watch_s}."
        )
    elif "GAMMA-" in reg_u:
        action_text = (
            "Gamma- → procurar continuação (breakout/continuation) com confirmação. "
            f"Watch: {watch_s}."
        )
    else:
        action_text = (
            "Regime neutro → reduzir agressividade; operar só em níveis claros. "
            f"Watch: {watch_s}."
        )

    return {
        "action_text": action_text,
        "below": below,
        "above": above,
        "watch": watch,
    }


def _plan_struct(
    spot: float,
    regime: str,
    selected_level: float,
    below: Optional[float],
    above: Optional[float],
) -> Optional[Plan]:
    # simplistic planner: entry at selected, stop a bit beyond, target to opposite wall or partial
    if not selected_level or selected_level <= 0:
        return None

    is_support = selected_level < spot
    reg_u = (regime or "").upper()

    if "GAMMA+" in reg_u:
        setup = "FADE"
        bias = "BUY bounce" if is_support else "SELL reject"
        entry = float(selected_level)
        # stop 0.15% beyond level
        stop = float(selected_level) * (0.9985 if is_support else 1.0015)
        # target: back to spot or nearest opposite wall
        if is_support:
            target = min(float(spot), float(above) if above else float(spot))
        else:
            target = max(float(spot), float(below) if below else float(spot))
        rationale = "Gamma+ favorece mean-reversion: entrar na rejeição do nível com stop curto."
    else:
        setup = "BREAKOUT"
        bias = "BUY break" if not is_support else "SELL break"
        entry = float(selected_level)
        stop = float(selected_level) * (0.999 if not is_support else 1.001)
        if not is_support:
            target = float(above) if (above and above > selected_level) else float(selected_level) * 1.01
        else:
            target = float(below) if (below and below < selected_level) else float(selected_level) * 0.99
        rationale = "Gamma- favorece movimento direcional: prefira confirmação e continuação."

    risk = abs(entry - stop)
    reward = abs(target - entry)
    rr = (reward / risk) if risk > 0 else 0.0

    return Plan(
        setup=setup,
        bias=bias,
        entry=float(entry),
        stop=float(stop),
        target=float(target),
        rr=float(rr),
        rationale=rationale,
    )


def _format_plan_text(
    plan: Optional[Plan],
    spot: float,
    level: float,
    regime: str,
    flip: Optional[float],
    below: Optional[float],
    above: Optional[float],
) -> str:
    if plan is None:
        return "—"

    def f0(x: Optional[float]) -> str:
        return f"{x:,.0f}" if isinstance(x, (int, float)) else "—"

    lines: List[str] = []
    lines.append(f"Setup: {plan.setup} | Bias: {plan.bias}")
    lines.append(f"Spot: {spot:,.2f} | Level: {level:,.2f}")
    lines.append(f"Entry: {plan.entry:,.2f} | Stop: {plan.stop:,.2f} | Target: {plan.target:,.2f} | RR: {plan.rr:.2f}")
    lines.append(f"Nearest below: {f0(below)} | Nearest above: {f0(above)} | Flip: {f0(flip)}")
    lines.append(f"Regime: {regime}")
    lines.append("")
    lines.append(plan.rationale)
    return "\n".join(lines)


def plan_from_selected_level(*args, **kwargs) -> Union[str, Optional[Plan]]:
    """
    Backward-compatible planner.

    - Legacy call (positional): plan_from_selected_level(spot, regime, selected_level, below, above) -> Plan | None
    - UI call (keywords used by qt_app.py): plan_from_selected_level(spot=..., level=..., regime=..., flip=..., nearest_below=..., nearest_above=...) -> str
    """
    # UI-style (keywords)
    if kwargs:
        spot = float(kwargs.get("spot") or 0.0)
        regime = str(kwargs.get("regime") or "")
        level = float(kwargs.get("level") or kwargs.get("selected_level") or 0.0)
        below = kwargs.get("nearest_below", kwargs.get("below"))
        above = kwargs.get("nearest_above", kwargs.get("above"))
        flip = kwargs.get("flip")

        try:
            below_f = float(below) if below is not None else None
        except Exception:
            below_f = None
        try:
            above_f = float(above) if above is not None else None
        except Exception:
            above_f = None
        try:
            flip_f = float(flip) if flip is not None else None
        except Exception:
            flip_f = None

        plan = _plan_struct(spot, regime, level, below_f, above_f)
        return _format_plan_text(plan, spot, level, regime, flip_f, below_f, above_f)

    # Legacy positional
    if len(args) >= 5:
        spot = float(args[0] or 0.0)
        regime = str(args[1] or "")
        selected_level = float(args[2] or 0.0)
        below = args[3]
        above = args[4]
        try:
            below_f = float(below) if below is not None else None
        except Exception:
            below_f = None
        try:
            above_f = float(above) if above is not None else None
        except Exception:
            above_f = None
        return _plan_struct(spot, regime, selected_level, below_f, above_f)

    return None
