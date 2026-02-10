'use client';

import { useEffect, useMemo, useState } from 'react';

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

function pct(a: number, b: number) {
  if (!b) return 0;
  return (a / b - 1) * 100;
}

export default function StrategyPlannerCard({
  selectedStrike,
  selected,
  expiry,
  expiries,
  setExpiry,
  spot,
  targetPct,
  setTargetPct,
}: {
  selectedStrike: number | null;
  selected: any | null;
  expiry: string;
  expiries: string[];
  setExpiry: (e: string) => void;
  spot: number;
  targetPct: number;
  setTargetPct: (x: number) => void;
}) {
  const [pricing, setPricing] = useState<'MARK' | 'MID'>('MARK');
  const [mode, setMode] = useState<'D1' | 'D2' | 'MANUAL'>('D1');

  const [callT, setCallT] = useState<any | null>(null);
  const [putT, setPutT] = useState<any | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [lastTs, setLastTs] = useState<number>(0);

  // apply D1/D2 auto-expiry
  useEffect(() => {
    if (mode === 'MANUAL') return;
    const idx = mode === 'D1' ? 0 : 1;
    const next = expiries?.[idx] || '';
    if (next && next !== expiry) setExpiry(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, expiries]);

  const callName = selected?.call?.instrument_name || '';
  const putName = selected?.put?.instrument_name || '';

  useEffect(() => {
    let alive = true;
    let t: any = null;

    async function tick() {
      if (!selectedStrike || !callName || !putName) return;
      try {
        setQErr(null);
        const [c, p] = await Promise.all([
          apiGet(`/api/desk/ticker?instrument=${encodeURIComponent(callName)}`),
          apiGet(`/api/desk/ticker?instrument=${encodeURIComponent(putName)}`),
        ]);
        if (!alive) return;
        setCallT(c.ticker);
        setPutT(p.ticker);
        setLastTs(Date.now());
      } catch (e: any) {
        if (!alive) return;
        setQErr(String(e?.message || e));
      }
    }

    // initial + polling
    tick();
    t = setInterval(tick, 1500);
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [selectedStrike, callName, putName]);

  const distPct = useMemo(() => {
    if (!selectedStrike || !spot) return 0;
    return pct(Number(selectedStrike), Number(spot));
  }, [selectedStrike, spot]);

  const premiums = useMemo(() => {
    const s = Number(spot || 0);
    const cBid = Number(callT?.best_bid_price ?? selected?.call?.bid_price ?? 0);
    const cAsk = Number(callT?.best_ask_price ?? selected?.call?.ask_price ?? 0);
    const pBid = Number(putT?.best_bid_price ?? selected?.put?.bid_price ?? 0);
    const pAsk = Number(putT?.best_ask_price ?? selected?.put?.ask_price ?? 0);

    const cMark = Number(callT?.mark_price ?? selected?.call?.mark_price ?? 0);
    const pMark = Number(putT?.mark_price ?? selected?.put?.mark_price ?? 0);

    const cMid = mid(cBid, cAsk);
    const pMid = mid(pBid, pAsk);

    const c = pricing === 'MARK' ? (cMark || cMid) : (cMid || cMark);
    const p = pricing === 'MARK' ? (pMark || pMid) : (pMid || pMark);

    // Deribit option price in underlying units ~ convert to USD by spot
    const callUsd = c * s;
    const putUsd = p * s;
    const totalUsd = callUsd + putUsd;

    const K = Number(selectedStrike || 0);
    const beLow = K - totalUsd;
    const beHigh = K + totalUsd;

    return { callUsd, putUsd, totalUsd, beLow, beHigh, cBid, cAsk, pBid, pAsk, cMark, pMark, cMid, pMid };
  }, [pricing, spot, callT, putT, selected, selectedStrike]);

  const ok = Boolean(selectedStrike && selected?.call && selected?.put && spot);

  return (
    <div className="h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-500">Planner + SuperDOM (real-time)</div>
        <div className="flex items-center gap-2">
          <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="D1">D1</option>
            <option value="D2">D2</option>
            <option value="MANUAL">Manual</option>
          </select>
          {mode === 'MANUAL' ? (
            <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {expiries.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          ) : null}
          <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs" value={pricing} onChange={(e) => setPricing(e.target.value as any)}>
            <option value="MARK">MARK</option>
            <option value="MID">MID</option>
          </select>
        </div>
      </div>

      {!ok ? (
        <div className="mt-3 text-sm text-slate-300">Clique em uma wall/strike para montar o plano.</div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
              <div className="text-[11px] text-slate-400">Spot</div>
              <div className="text-sm font-semibold">{Number(spot).toFixed(0)}</div>
            </div>
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
              <div className="text-[11px] text-slate-400">Wall (K)</div>
              <div className="text-sm font-semibold">{Number(selectedStrike).toFixed(0)}</div>
              <div className={`text-[11px] ${distPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{distPct >= 0 ? '+' : ''}{distPct.toFixed(2)}%</div>
            </div>
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-2">
              <div className="text-[11px] text-slate-400">Atualização</div>
              <div className="text-[11px] text-slate-300">{lastTs ? `${((Date.now() - lastTs) / 1000).toFixed(1)}s` : '—'}</div>
              {qErr ? <div className="text-[11px] text-amber-300">{qErr}</div> : null}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
              <div className="text-xs font-semibold">CALL</div>
              <div className="mt-1 text-[11px] text-slate-400">Bid/Ask: {premiums.cBid?.toFixed?.(4) ?? '—'} / {premiums.cAsk?.toFixed?.(4) ?? '—'}</div>
              <div className="text-[11px] text-slate-400">Mark/Mid: {premiums.cMark?.toFixed?.(4) ?? '—'} / {premiums.cMid?.toFixed?.(4) ?? '—'}</div>
              <div className="mt-1 text-[11px] text-slate-300">Premium USD: <span className="font-semibold">${premiums.callUsd.toFixed(2)}</span></div>
            </div>
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
              <div className="text-xs font-semibold">PUT</div>
              <div className="mt-1 text-[11px] text-slate-400">Bid/Ask: {premiums.pBid?.toFixed?.(4) ?? '—'} / {premiums.pAsk?.toFixed?.(4) ?? '—'}</div>
              <div className="text-[11px] text-slate-400">Mark/Mid: {premiums.pMark?.toFixed?.(4) ?? '—'} / {premiums.pMid?.toFixed?.(4) ?? '—'}</div>
              <div className="mt-1 text-[11px] text-slate-300">Premium USD: <span className="font-semibold">${premiums.putUsd.toFixed(2)}</span></div>
            </div>
          </div>

          <div className="mt-3 bg-slate-950/40 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">Plano (BUY CALL + BUY PUT no mesmo strike)</div>
              <div className="text-xs text-slate-400">Expiry: {expiry || '—'} · Target: {targetPct.toFixed(2)}%</div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] text-slate-400">Custo total (USD)</div>
                <div className="text-sm font-semibold">${premiums.totalUsd.toFixed(2)}</div>
                <div className="text-[11px] text-slate-500">Risco máx: prêmio</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Breakeven</div>
                <div className="text-[11px] text-slate-300">Low: {premiums.beLow.toFixed(0)}</div>
                <div className="text-[11px] text-slate-300">High: {premiums.beHigh.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Alvo</div>
                <input
                  className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs"
                  type="number"
                  step="0.1"
                  value={targetPct}
                  onChange={(e) => setTargetPct(parseFloat(e.target.value || '1.5'))}
                />
                <div className="text-[11px] text-slate-500 mt-1">meta mínima ≥ 1.5%</div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">Dica: se o premium total estiver “alto” vs alvo, a estratégia fica mais difícil (precisa movimento maior).</div>
          </div>
        </>
      )}
    </div>
  );
}
