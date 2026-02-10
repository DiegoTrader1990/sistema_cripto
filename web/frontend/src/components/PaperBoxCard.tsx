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
  spot: number;
  targetPct: number;
  pricing: 'MARK' | 'MID';
  callPremUsd: number;
  putPremUsd: number;
  totalCostUsd: number;
  note?: string;
  closedTs?: number;
  closeSpot?: number;
  pnlUsd?: number;
};

const LS_KEY = 'paperbox.v1';

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
  const [cash0, setCash0] = useState(1000);
  const [riskUsd, setRiskUsd] = useState(150);
  const [pricing, setPricing] = useState<'MARK' | 'MID'>('MARK');
  const [trades, setTrades] = useState<PaperTrade[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (typeof obj?.cash0 === 'number') setCash0(obj.cash0);
      if (typeof obj?.riskUsd === 'number') setRiskUsd(obj.riskUsd);
      if (obj?.pricing === 'MID') setPricing('MID');
      if (Array.isArray(obj?.trades)) setTrades(obj.trades);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ cash0, riskUsd, pricing, trades }));
    } catch {
      // ignore
    }
  }, [cash0, riskUsd, pricing, trades]);

  const openTrades = useMemo(() => trades.filter((t) => !t.closedTs), [trades]);
  const closedTrades = useMemo(() => trades.filter((t) => t.closedTs), [trades]);

  const pnl = useMemo(() => {
    const p = closedTrades.reduce((a, t) => a + Number(t.pnlUsd || 0), 0);
    return p;
  }, [closedTrades]);

  const equity = useMemo(() => cash0 + pnl, [cash0, pnl]);

  function simulateEntry() {
    if (!selected || !selected.call || !selected.put || !spot) return;

    const callPrem = premUsd(selected.call, spot, pricing);
    const putPrem = premUsd(selected.put, spot, pricing);
    const total = callPrem + putPrem;

    const t: PaperTrade = {
      id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      ts: Date.now(),
      expiry,
      strike: Number(selected.strike),
      spot,
      targetPct,
      pricing,
      callPremUsd: callPrem,
      putPremUsd: putPrem,
      totalCostUsd: total,
    };
    setTrades([t, ...trades]);
  }

  function closeTrade(id: string) {
    const closeSpotStr = prompt('Fechar operação: informe spot de saída (USD)', String(spot || ''));
    if (!closeSpotStr) return;
    const closeSpot = Number(closeSpotStr);
    if (!closeSpot || closeSpot <= 0) return;

    setTrades(
      trades.map((t) => {
        if (t.id !== id) return t;
        // rough payoff at close
        const K = t.strike;
        const callPay = Math.max(0, closeSpot - K);
        const putPay = Math.max(0, K - closeSpot);
        const gross = callPay + putPay;
        const pnlUsd = gross - t.totalCostUsd;
        return { ...t, closedTs: Date.now(), closeSpot, pnlUsd };
      })
    );
  }

  function resetAll() {
    if (!confirm('Resetar simulações?')) return;
    setTrades([]);
  }

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

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">Equity (realizado)</div>
          <div className="text-lg font-semibold">${equity.toFixed(2)}</div>
          <div className="text-xs text-slate-400">PnL: {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</div>
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">Ações</div>
          <button
            className="mt-2 w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3 py-2 text-sm font-semibold"
            disabled={!selected?.call || !selected?.put}
            onClick={simulateEntry}
          >
            Simular Entrada
          </button>
          <div className="mt-2 text-[11px] text-slate-500">Seleciona um strike (wall) antes.</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-slate-400">Abertas: {openTrades.length} · Fechadas: {closedTrades.length}</div>
        <div className="mt-2 space-y-2 max-h-[220px] overflow-auto">
          {openTrades.map((t) => (
            <div key={t.id} className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">STRANGLE {t.strike} · {t.expiry}</div>
                <button className="text-xs text-slate-300 hover:text-white" onClick={() => closeTrade(t.id)}>
                  Encerrar
                </button>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Custo: ${t.totalCostUsd.toFixed(2)} (C ${t.callPremUsd.toFixed(2)} + P ${t.putPremUsd.toFixed(2)}) · {t.pricing}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
