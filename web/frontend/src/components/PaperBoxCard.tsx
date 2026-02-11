'use client';

import { useEffect, useMemo, useState } from 'react';

type SelectedStrike = {
  strike: number;
  call?: any;
  put?: any;
};

type PaperTrade = {
  id: string;
  ts: number;
  expiry: string;
  strike: number;
  spot: number; // entry spot
  targetPct: number;
  pricing: 'MARK' | 'MID';
  // instruments (for real-time MTM)
  callName: string;
  putName: string;
  // entry snapshot (from chain row)
  callEntry?: { bid?: number; ask?: number; mark?: number; iv?: number; oi?: number };
  putEntry?: { bid?: number; ask?: number; mark?: number; iv?: number; oi?: number };
  callPremUsd: number;
  putPremUsd: number;
  totalCostUsd: number;
  note?: string;
  // close
  closedTs?: number;
  closeSpot?: number;
  closeValueUsd?: number;
  pnlUsd?: number;
};

// LocalStorage (legacy) still used for preferences only; trades now live server-side.
const LS_KEY = 'paperbox.v1';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

async function apiGet(path: string) {
  const tok = localStorage.getItem('token') || '';
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'request failed');
  return data;
}

function mid(b?: number, a?: number) {
  const bb = Number(b || 0);
  const aa = Number(a || 0);
  if (bb > 0 && aa > 0) return (bb + aa) / 2;
  return bb || aa || 0;
}

function premUsd(row: any, spot: number, pricing: 'MARK' | 'MID') {
  // Deribit option prices are in underlying units; approximate to USD with spot.
  const mark = Number(row?.mark_price || 0);
  const m = mid(row?.bid_price, row?.ask_price);
  const prem = pricing === 'MARK' ? (mark || m) : (m || mark);
  return prem * spot;
}

function premUsdFromTicker(t: any, spot: number, pricing: 'MARK' | 'MID') {
  const mark = Number(t?.mark_price || 0);
  const m = mid(t?.best_bid_price, t?.best_ask_price);
  const prem = pricing === 'MARK' ? (mark || m) : (m || mark);
  return prem * Number(spot || 0);
}

export default function PaperBoxCard({
  selected,
  expiry,
  spot,
  targetPct,
}: {
  selected: SelectedStrike | null;
  expiry: string;
  spot: number;
  targetPct: number;
}) {
  const [cash0, setCash0] = useState(1000); // capital base
  const [riskUsd, setRiskUsd] = useState(150);
  const [pricing, setPricing] = useState<'MARK' | 'MID'>('MARK');
  const [autoOn, setAutoOn] = useState<boolean>(true);
  const [qty, setQty] = useState<number>(0);
  const [minLot, setMinLot] = useState<number | null>(null);
  const [tpUsd, setTpUsd] = useState<number>(150);
  const [slUsd, setSlUsd] = useState<number>(150);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [serverOpen, setServerOpen] = useState<any[]>([]);
  const [serverHist, setServerHist] = useState<any[]>([]);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const [mtm, setMtm] = useState<Record<string, { ts: number; valueUsd: number; pnlUsd: number; callT?: any; putT?: any; spot?: number }>>({});
  const [mtmErr, setMtmErr] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mtmAgeSec, setMtmAgeSec] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (typeof obj?.cash0 === 'number') setCash0(obj.cash0);
      if (typeof obj?.riskUsd === 'number') setRiskUsd(obj.riskUsd);
      if (typeof obj?.tpUsd === 'number') setTpUsd(obj.tpUsd);
      if (typeof obj?.slUsd === 'number') setSlUsd(obj.slUsd);
      if (typeof obj?.autoOn === 'boolean') setAutoOn(obj.autoOn);
      if (obj?.pricing === 'MID') setPricing('MID');
      if (typeof obj?.qty === 'number') setQty(obj.qty);
      if (Array.isArray(obj?.trades)) setTrades(obj.trades);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ cash0, riskUsd, pricing, autoOn, tpUsd, slUsd, qty, trades }));
    } catch {
      // ignore
    }
  }, [cash0, riskUsd, pricing, trades, qty]);

  const openTrades = useMemo(() => trades.filter((t) => !t.closedTs), [trades]);
  const closedTrades = useMemo(() => trades.filter((t) => t.closedTs), [trades]);

  const openServer = useMemo(() => (serverOpen || []).filter((t) => !t.closed_ts), [serverOpen]);

  // If there are open trades and nothing is selected, keep it unselected (user might be preparing a new entry).
  // (We still show the open trades list above.)

  const activeTrade = useMemo(() => {
    if (!activeId) return null;
    return trades.find((t) => t.id === activeId) || null;
  }, [activeId, trades]);

  const activeServerTrade = useMemo(() => {
    if (!activeId) return null;
    return (serverOpen || []).find((t) => String(t.id) === String(activeId)) || null;
  }, [activeId, serverOpen]);

  const pnl = useMemo(() => {
    const p = closedTrades.reduce((a, t) => a + Number(t.pnlUsd || 0), 0);
    return p;
  }, [closedTrades]);

  const equity = useMemo(() => cash0 + pnl, [cash0, pnl]);

  const leverage = useMemo(() => {
    const sp = Number(spot || 0);
    if (!sp || !qty || !equity) return null;
    const notional = sp * Number(qty || 0);
    return notional / equity;
  }, [spot, qty, equity]);

  function simulateEntry() {
    if (!selected || !selected.call || !selected.put || !spot) return;

    const callName = String(selected.call?.instrument_name || '');
    const putName = String(selected.put?.instrument_name || '');
    if (!callName || !putName) return;

    const q = Math.max(0, Number(qty || 0));
    if (!q) return;

    const callPrem = premUsd(selected.call, spot, pricing) * q;
    const putPrem = premUsd(selected.put, spot, pricing) * q;
    const total = callPrem + putPrem;

    const t: PaperTrade = {
      id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      ts: Date.now(),
      expiry,
      strike: Number(selected.strike),
      spot,
      targetPct,
      pricing,
      callName,
      putName,
      callEntry: {
        bid: Number(selected.call?.bid_price || 0) || undefined,
        ask: Number(selected.call?.ask_price || 0) || undefined,
        mark: Number(selected.call?.mark_price || 0) || undefined,
        iv: Number(selected.call?.mark_iv || 0) || undefined,
        oi: Number(selected.call?.open_interest || 0) || undefined,
      },
      putEntry: {
        bid: Number(selected.put?.bid_price || 0) || undefined,
        ask: Number(selected.put?.ask_price || 0) || undefined,
        mark: Number(selected.put?.mark_price || 0) || undefined,
        iv: Number(selected.put?.mark_iv || 0) || undefined,
        oi: Number(selected.put?.open_interest || 0) || undefined,
      },
      callPremUsd: callPrem,
      putPremUsd: putPrem,
      totalCostUsd: total,
    };
    // Create server-side paper trade (preferred)
    (async () => {
      try {
        const cur = callName.startsWith('ETH') ? 'ETH' : 'BTC';
        const perp = `${cur}-PERPETUAL`;
        const spotT = await apiGet(`/api/desk/ticker?instrument=${encodeURIComponent(perp)}`);
        const spotIndex = Number(spotT?.ticker?.index_price || 0);
        const spotLast = Number(spotT?.ticker?.last_price || 0);
        const spotNow = Number(spotIndex || spotLast || spot);

        // estimate entry costs in USD using spotNow
        const askCall = Number(selected.call?.ask_price || 0);
        const askPut = Number(selected.put?.ask_price || 0);
        const bidCall = Number(selected.call?.bid_price || 0);
        const bidPut = Number(selected.put?.bid_price || 0);
        const midCall = mid(bidCall, askCall);
        const midPut = mid(bidPut, askPut);
        const markCall = Number(selected.call?.mark_price || 0);
        const markPut = Number(selected.put?.mark_price || 0);

        const costAsk = (askCall + askPut) * spotNow * q;
        const costMid = (midCall + midPut) * spotNow * q;
        const costMark = (markCall + markPut) * spotNow * q;

        const resp = await fetch(`${API_BASE}/api/paper/entry`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currency: cur,
            expiry,
            strike: Number(selected.strike),
            qty: q,
            callName,
            putName,
            entry_spot: spotNow,
            entry_spot_index: spotIndex,
            entry_spot_last: spotLast,
            entry_cost_usd: costAsk,
            entry_cost_ask: costAsk,
            entry_cost_mid: costMid,
            entry_cost_mark: costMark,
            entry_call: {
              bid: Number(selected.call?.bid_price || 0),
              ask: Number(selected.call?.ask_price || 0),
              mark: Number(selected.call?.mark_price || 0),
              iv: Number(selected.call?.mark_iv || 0),
              oi: Number(selected.call?.open_interest || 0),
            },
            entry_put: {
              bid: Number(selected.put?.bid_price || 0),
              ask: Number(selected.put?.ask_price || 0),
              mark: Number(selected.put?.mark_price || 0),
              iv: Number(selected.put?.mark_iv || 0),
              oi: Number(selected.put?.open_interest || 0),
            },
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.error || 'paper entry failed');
        setActiveId(String(data.trade?.id || ''));
      } catch (e: any) {
        setMtmErr(String(e?.message || e));
      }
    })();

    // keep legacy local trade too (for now, until fully migrated)
    setTrades([t, ...trades]);
    setActiveId(t.id);
  }

  function calcPnlAtSpot(t: PaperTrade, sp: number) {
    const closeSpot = Number(sp || 0);
    if (!closeSpot || closeSpot <= 0) return null;
    const K = Number(t.strike || 0);
    const callPay = Math.max(0, closeSpot - K);
    const putPay = Math.max(0, K - closeSpot);
    const gross = callPay + putPay;
    const pnlUsd = gross - Number(t.totalCostUsd || 0);
    return { closeSpot, gross, pnlUsd };
  }

  async function closeServerTrade(id: string, reason: string = 'manual') {
    const tok = localStorage.getItem('token') || '';
    const res = await fetch(`${API_BASE}/api/paper/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'close failed');
    // refresh quickly
    try {
      const op = await apiGet('/api/paper/open');
      setServerOpen(op.open || []);
    } catch {}
    return data;
  }

  function closeTrade(id: string, closeSpotOverride?: number) {
    let closeSpot = Number(closeSpotOverride || 0);

    if (!closeSpot) {
      const closeSpotStr = prompt('Fechar operação: informe spot de saída (USD)', String(spot || ''));
      if (!closeSpotStr) return;
      closeSpot = Number(closeSpotStr);
    }

    if (!closeSpot || closeSpot <= 0) return;

    setTrades(
      trades.map((t) => {
        if (t.id !== id) return t;

        // Prefer MTM if available (real-time), otherwise fallback to intrinsic approximation.
        const m = mtm[id];
        if (m) {
          return {
            ...t,
            closedTs: Date.now(),
            closeSpot,
            closeValueUsd: Number(m.valueUsd || 0),
            pnlUsd: Number(m.pnlUsd || 0),
          };
        }

        const out = calcPnlAtSpot(t, closeSpot);
        if (!out) return t;
        return { ...t, closedTs: Date.now(), closeSpot: out.closeSpot, closeValueUsd: out.gross, pnlUsd: out.pnlUsd };
      })
    );
  }

  function resetAll() {
    if (!confirm('Resetar simulações?')) return;
    setTrades([]);
  }

  // Real-time MTM (mark/mid) for open trades
  // Detect min lot for the currently selected instruments (Deribit min_trade_amount)
  useEffect(() => {
    let alive = true;
    async function run() {
      try {
        const callName = String(selected?.call?.instrument_name || '');
        const putName = String(selected?.put?.instrument_name || '');
        if (!callName || !putName) return;

        const [c, p] = await Promise.all([
          apiGet(`/api/desk/instrument?instrument=${encodeURIComponent(callName)}`),
          apiGet(`/api/desk/instrument?instrument=${encodeURIComponent(putName)}`),
        ]);
        const mc = Number(c?.meta?.min_trade_amount || 0);
        const mp = Number(p?.meta?.min_trade_amount || 0);
        const m = Math.max(mc || 0, mp || 0);
        if (!alive) return;
        if (m > 0) {
          setMinLot(m);
          // if qty is unset or lower than min, set to min by default
          setQty((q) => (!q || q < m ? m : q));
        }
      } catch {
        // ignore
      }
    }
    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.call?.instrument_name, selected?.put?.instrument_name]);

  // Server-side paper sync + MTM refresh
  useEffect(() => {
    let alive = true;
    let timer: any = null;

    async function tick() {
      try {
        setServerErr(null);
        const [op, hist] = await Promise.all([apiGet('/api/paper/open'), apiGet('/api/paper/history?limit=200')]);
        if (!alive) return;
        setServerOpen(op.open || []);
        setServerHist(hist.history || []);
      } catch (e: any) {
        if (!alive) return;
        setServerErr(String(e?.message || e));
      }

      // MTM for the selected open server trade
      try {
        if (activeId) {
          const mt = await apiGet(`/api/paper/mtm?id=${encodeURIComponent(String(activeId))}`);
          if (!alive) return;
          setMtm((prev) => ({
            ...prev,
            [String(activeId)]: {
              ts: Date.now(),
              valueUsd: Number(mt.value_usd || 0),
              pnlUsd: Number(mt.pnl_usd || 0),
              callT: mt.call,
              putT: mt.put,
              spot: Number(mt.spot || 0),
            },
          }));
          setMtmAgeSec(0);
        }
      } catch {
        // ignore
      }

      // legacy local MTM (manual-only) stays for now
      if (!openTrades.length || !spot) return;
      try {
        setMtmErr(null);
        const sp = Number(spot || 0);
        const next: Record<string, { ts: number; valueUsd: number; pnlUsd: number; callT?: any; putT?: any; spot?: number }> = {};

        // Limit per tick to avoid spam (demo). Most times you have few open trades.
        const list = openTrades.slice(0, 8);
        for (const t of list) {
          if (!t.callName || !t.putName) continue;
          const [c, p] = await Promise.all([
            apiGet(`/api/desk/ticker?instrument=${encodeURIComponent(t.callName)}`),
            apiGet(`/api/desk/ticker?instrument=${encodeURIComponent(t.putName)}`),
          ]);
          const callUsd = premUsdFromTicker(c.ticker, sp, t.pricing);
          const putUsd = premUsdFromTicker(p.ticker, sp, t.pricing);
          const valueUsd = callUsd + putUsd;
          const pnlUsd = valueUsd - Number(t.totalCostUsd || 0);
          next[t.id] = { ts: Date.now(), valueUsd, pnlUsd, callT: c?.ticker, putT: p?.ticker, spot: sp };
        }

        if (!alive) return;
        const now = Date.now();
        setMtm((prev) => ({ ...prev, ...next }));

        // age = newest mtm timestamp among open trades
        let newest = 0;
        for (const id of Object.keys(next)) newest = Math.max(newest, next[id].ts);
        if (newest) setMtmAgeSec((now - newest) / 1000);
      } catch (e: any) {
        if (!alive) return;
        setMtmErr(String(e?.message || e));
      }
    }

    tick();
    timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrades, spot, activeId]);

  // Auto TP/SL (closes using MTM value)
  useEffect(() => {
    if (!autoOn) return;
    if (!openTrades.length) return;

    const now = Date.now();
    const toClose: { id: string; reason: string }[] = [];

    for (const t of openTrades) {
      const m = mtm[t.id];
      if (!m) continue;
      // require reasonably fresh mtm
      if (now - Number(m.ts || 0) > 10_000) continue;
      if (tpUsd > 0 && m.pnlUsd >= tpUsd) toClose.push({ id: t.id, reason: `TP +${tpUsd}` });
      if (slUsd > 0 && m.pnlUsd <= -Math.abs(slUsd)) toClose.push({ id: t.id, reason: `SL -${slUsd}` });
    }

    if (!toClose.length) return;

    setTrades(
      trades.map((t) => {
        const hit = toClose.find((x) => x.id === t.id);
        if (!hit) return t;
        const m = mtm[t.id];
        if (!m) return t;
        return {
          ...t,
          note: (t.note ? t.note + ' | ' : '') + `auto:${hit.reason}`,
          closedTs: Date.now(),
          closeSpot: Number(spot || 0),
          closeValueUsd: Number(m.valueUsd || 0),
          pnlUsd: Number(m.pnlUsd || 0),
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, tpUsd, slUsd, mtm, openTrades.length, spot]);

  const openWithMtM = useMemo(() => {
    const sp = Number(spot || 0);
    return openTrades
      .map((t) => {
        const m = mtm[t.id];
        const pnlUsd = m?.pnlUsd ?? null;
        const valueUsd = m?.valueUsd ?? null;
        const K = Number(t.strike || 0);
        const cost = Number(t.totalCostUsd || 0);
        const beLow = K - cost;
        const beHigh = K + cost;
        return { t, pnlUsd, valueUsd, beLow, beHigh, sp };
      })
      .sort((a, b) => Number(b.t.ts) - Number(a.t.ts));
  }, [openTrades, spot, mtm]);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Caixa / Simulador</div>
        <button className="text-xs text-slate-400 hover:text-slate-200" onClick={resetAll}>
          reset
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Caixa inicial</div>
          <input className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm" type="number" value={cash0} onChange={(e) => setCash0(Number(e.target.value || 0))} />
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Risco por trade (USD)</div>
          <input className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm" type="number" value={riskUsd} onChange={(e) => setRiskUsd(Number(e.target.value || 0))} />
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Pricing</div>
          <select className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm" value={pricing} onChange={(e) => setPricing(e.target.value as any)}>
            <option value="MARK">MARK</option>
            <option value="MID">MID</option>
          </select>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Auto TP/SL</div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} />
            Ativar
          </label>
          {mtmErr ? <div className="mt-1 text-[11px] text-amber-300">mtm: {mtmErr}</div> : null}
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Take Profit (USD)</div>
          <input className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm" type="number" value={tpUsd} onChange={(e) => setTpUsd(Number(e.target.value || 0))} />
          <div className="text-[11px] text-slate-500">fecha quando PnL ≥ TP</div>
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
          <div className="text-[11px] text-slate-400">Stop Loss (USD)</div>
          <input className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm" type="number" value={slUsd} onChange={(e) => setSlUsd(Number(e.target.value || 0))} />
          <div className="text-[11px] text-slate-500">fecha quando PnL ≤ -SL</div>
        </div>
      </div>

      {(openServer.length || openTrades.length) ? (
        <div className="mt-3 bg-slate-950/40 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold">Operações abertas ({openServer.length || openTrades.length})</div>
            <div className="text-[11px] text-slate-500">clique para selecionar</div>
          </div>
          {serverErr ? <div className="mt-2 text-[11px] text-amber-300">paper sync: {serverErr}</div> : null}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(openServer.length ? openServer : openTrades).slice(0, 6).map((t: any) => {
              const tid = String(t.id);
              const p = mtm[tid]?.pnlUsd;
              const cls = p == null ? 'border-slate-800' : p >= 0 ? 'border-emerald-500/40' : 'border-rose-500/40';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveId((prev) => (String(prev) === String(tid) ? null : tid))}
                  className={`text-left bg-slate-900/30 border ${cls} rounded-lg p-2 hover:border-slate-600 ${String(activeId) === String(tid) ? 'outline outline-1 outline-blue-500/40' : ''}`}
                  title={t.id}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-slate-200">K {Number(t.strike).toFixed(0)}</div>
                    <div className="text-[11px] text-slate-500">{t.expiry}</div>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-[11px] text-slate-500">cost ${Number(t.entry_cost_usd ?? t.totalCostUsd || 0).toFixed(0)}</div>
                    <div className={`text-[11px] font-semibold ${p == null ? 'text-slate-500' : p >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{p == null ? '—' : `${p >= 0 ? '+' : ''}${Number(p).toFixed(2)}`}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeServerTrade && !activeServerTrade.closed_ts ? (
        <div className="mt-3 bg-slate-950/40 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold">EM POSIÇÃO</div>
              <div className="text-[11px] text-slate-500 break-all">{activeServerTrade.callName} + {activeServerTrade.putName}</div>
            </div>
            <div className="text-[11px] text-slate-500">mtm age: {mtmAgeSec == null ? '—' : `${mtmAgeSec.toFixed(1)}s`}</div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <div className="text-[11px] text-slate-400">Custo (entrada)</div>
              <div className="text-sm font-semibold">${Number(activeServerTrade.entry_cost_usd || 0).toFixed(2)}</div>
              <div className="text-[11px] text-slate-500">spot entrada: {Number(activeServerTrade.entry_spot || 0).toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Valor atual (a mercado)</div>
              <div className="text-sm font-semibold">{mtm[String(activeId || '')]?.valueUsd != null ? `$${Number(mtm[String(activeId || '')].valueUsd).toFixed(2)}` : '—'}</div>
              <div className="text-[11px] text-slate-500">spot agora: {Number(mtm[String(activeId || '')]?.spot ?? spot ?? 0).toFixed(0)}</div>
              <div className="text-[11px] text-slate-500">call+put (MARK): {(() => {
                const sp = Number(mtm[String(activeId || '')]?.spot ?? spot ?? 0);
                const c = premUsdFromTicker(mtm[String(activeId || '')]?.callT, sp, 'MARK');
                const p = premUsdFromTicker(mtm[String(activeId || '')]?.putT, sp, 'MARK');
                const tot = (c || 0) + (p || 0);
                return tot ? `$${tot.toFixed(2)}` : '—';
              })()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">PnL (MTM)</div>
              {(() => {
                const p = mtm[String(activeId || '')]?.pnlUsd;
                const cls = p == null ? 'text-slate-500' : p >= 0 ? 'text-emerald-300' : 'text-rose-300';
                return <div className={`text-lg font-bold ${cls}`}>{p == null ? '—' : `${p >= 0 ? '+' : ''}${Number(p).toFixed(2)}`}</div>;
              })()}
              <div className="text-[11px] text-slate-500">src: {activeServerTrade.src || '—'} | expiry: {activeServerTrade.expiry}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-2">
              <div className="font-semibold text-slate-200">CALL</div>
              <div className="text-slate-500 break-all">{activeServerTrade.callName}</div>
              <div className="mt-1 text-slate-400">Entrada: bid {activeServerTrade.entry_call?.bid ?? '—'} / ask {activeServerTrade.entry_call?.ask ?? '—'} / mark {activeServerTrade.entry_call?.mark ?? '—'}</div>
              <div className="text-slate-500">IV {activeServerTrade.entry_call?.iv ?? '—'} | OI {activeServerTrade.entry_call?.oi ?? '—'}</div>
              <div className="mt-1 text-slate-200">Agora: bid {mtm[String(activeId || '')]?.callT?.best_bid_price ?? '—'} / ask {mtm[String(activeId || '')]?.callT?.best_ask_price ?? '—'} / mark {mtm[String(activeId || '')]?.callT?.mark_price ?? '—'}</div>
              <div className="text-slate-500">USD agora (MARK): {(() => {
                const sp = Number(mtm[String(activeId || '')]?.spot ?? spot ?? 0);
                const usd = premUsdFromTicker(mtm[String(activeId || '')]?.callT, sp, 'MARK');
                return usd ? `$${usd.toFixed(2)}` : '—';
              })()}</div>
            </div>
            <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-2">
              <div className="font-semibold text-slate-200">PUT</div>
              <div className="text-slate-500 break-all">{activeServerTrade.putName}</div>
              <div className="mt-1 text-slate-400">Entrada: bid {activeServerTrade.entry_put?.bid ?? '—'} / ask {activeServerTrade.entry_put?.ask ?? '—'} / mark {activeServerTrade.entry_put?.mark ?? '—'}</div>
              <div className="text-slate-500">IV {activeServerTrade.entry_put?.iv ?? '—'} | OI {activeServerTrade.entry_put?.oi ?? '—'}</div>
              <div className="mt-1 text-slate-200">Agora: bid {mtm[String(activeId || '')]?.putT?.best_bid_price ?? '—'} / ask {mtm[String(activeId || '')]?.putT?.best_ask_price ?? '—'} / mark {mtm[String(activeId || '')]?.putT?.mark_price ?? '—'}</div>
              <div className="text-slate-500">USD agora (MARK): {(() => {
                const sp = Number(mtm[String(activeId || '')]?.spot ?? spot ?? 0);
                const usd = premUsdFromTicker(mtm[String(activeId || '')]?.putT, sp, 'MARK');
                return usd ? `$${usd.toFixed(2)}` : '—';
              })()}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">Equity (realizado)</div>
          <div className="text-lg font-semibold">${equity.toFixed(2)}</div>
          <div className="text-xs text-slate-400">PnL: {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Alav. efetiva (aprox): {leverage == null ? '—' : leverage.toFixed(2)}x</div>
          <div className="text-[11px] text-slate-500">Margem (long opções): ≈ prêmio pago (custo)</div>
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">Ações</div>
          <button
            className="mt-2 w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3 py-2 text-sm font-semibold"
            disabled={!selected?.call || !selected?.put || !qty || openServer.length > 0}
            onClick={simulateEntry}
          >
            Entrar (paper)
          </button>
          {openServer.length > 0 ? <div className="mt-2 text-[11px] text-slate-500">Já existe posição aberta no servidor (A1). Feche para abrir outra.</div> : null}
          {!selected?.call?.instrument_name || !selected?.put?.instrument_name ? (
            <div className="mt-2 text-[11px] text-amber-300">Sem instrument_name para CALL/PUT (não dá pra MTM). Selecione outro strike/expiry.</div>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              className="w-full rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600 disabled:opacity-60 px-3 py-2 text-xs font-semibold"
              disabled={!activeId}
              onClick={() => activeId && closeServerTrade(String(activeId), 'manual')}
              title="Fechar a operação selecionada (server-side)"
            >
              Fechar posição
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">Clique em uma entrada ativa abaixo para selecionar.</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-slate-400">Abertas: {openTrades.length} · Fechadas: {closedTrades.length}</div>

        <div className="mt-2 space-y-2 max-h-[240px] overflow-auto">
          {openWithMtM.map(({ t, pnlUsd, valueUsd, beLow, beHigh }) => (
            <button
              key={t.id}
              className={`w-full text-left bg-slate-950/40 border rounded-xl p-3 hover:border-slate-600 ${activeId === t.id ? 'border-blue-500/70' : 'border-slate-800'}`}
              onClick={() => setActiveId(t.id)}
              title="Selecionar esta operação"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">STRADDLE {t.strike} · {t.expiry}</div>
                  <div className="text-[11px] text-slate-500">aberta: {new Date(t.ts).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs bg-slate-900 border border-slate-800 rounded px-2 py-1 hover:border-slate-600"
                    onClick={() => closeTrade(t.id, Number(spot || 0))}
                    disabled={!spot}
                    title="Fechar usando o spot atual"
                  >
                    Fechar @spot
                  </button>
                  <button className="text-xs text-slate-300 hover:text-white" onClick={() => closeTrade(t.id)}>
                    Encerrar
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[11px] text-slate-400">Custo</div>
                  <div className="text-[11px] text-slate-200">${t.totalCostUsd.toFixed(2)} ({t.pricing})</div>
                  <div className="text-[11px] text-slate-500">C ${t.callPremUsd.toFixed(2)} + P ${t.putPremUsd.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Breakevens</div>
                  <div className="text-[11px] text-slate-200">{beLow.toFixed(0)} / {beHigh.toFixed(0)}</div>
                  <div className="text-[11px] text-slate-500">spot: {Number(spot || 0).toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">PnL (mark-to-market)</div>
                  <div className={`text-sm font-semibold ${pnlUsd == null ? 'text-slate-500' : pnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {pnlUsd == null ? '—' : `${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)}`}
                  </div>
                  <div className="text-[11px] text-slate-500">valor: {valueUsd == null ? '—' : `$${valueUsd.toFixed(2)}`}</div>
                </div>
              </div>
            </button>
          ))}

          {!openWithMtM.length ? (
            <div className="text-xs text-slate-500">Nenhuma operação aberta.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
