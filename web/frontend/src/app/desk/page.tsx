'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

import CandlesChart, { type Ohlc } from '@/components/CandlesChart';

type OhlcWithVol = Ohlc & { v?: number[] };

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

export default function DeskPage() {
  const r = useRouter();
  const [instrument, setInstrument] = useState('BTC-PERPETUAL');
  const [tf, setTf] = useState('60');
  const [candles, setCandles] = useState(900);
  const [ohlc, setOhlc] = useState<OhlcWithVol | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // options/gex
  const [expiry, setExpiry] = useState<string>('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [gexOn, setGexOn] = useState<boolean>(false);
  const [gexLevels, setGexLevels] = useState<{ strike: number; gex: number }[]>([]);
  const [flip, setFlip] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [planTargetPct, setPlanTargetPct] = useState<number>(1.5);

  async function refresh() {
    setErr(null);
    try {
      const data = await apiGet(`/api/desk/ohlc?instrument=${encodeURIComponent(instrument)}&tf=${encodeURIComponent(tf)}&candles=${candles}`);
      setOhlc(data.ohlc);

      // options/gex (BTC only for now)
      const ex = await apiGet(`/api/desk/expiries?currency=${instrument.startsWith('ETH') ? 'ETH' : 'BTC'}`);
      const exs = (ex.expiries || []) as string[];
      setExpiries(exs);
      const chosen = expiry || exs[0] || '';
      setExpiry(chosen);
      if (chosen) {
        const cg = await apiGet(`/api/desk/chain?currency=${instrument.startsWith('ETH') ? 'ETH' : 'BTC'}&expiry=${encodeURIComponent(chosen)}`);
        setFlip(cg.flip ?? null);
        // take top walls as levels
        setGexLevels((cg.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
      if (String(e?.message || '').includes('unauthorized')) {
        localStorage.removeItem('token');
        r.push('/login');
      }
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, tf, candles]);

  const last = useMemo(() => {
    if (!ohlc?.c?.length) return null;
    return ohlc.c[ohlc.c.length - 1];
  }, [ohlc]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">Desk</h1>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/login">(trocar login)</a>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/altcoins">Altcoins</a>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="/news">News</a>
      </div>

      <div className="mt-4 flex gap-3 items-center flex-wrap">
        <label className="text-sm text-slate-300">Instrument</label>
        <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
          <option>BTC-PERPETUAL</option>
          <option>ETH-PERPETUAL</option>
        </select>

        <label className="text-sm text-slate-300">TF</label>
        <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1" value={tf} onChange={(e) => setTf(e.target.value)}>
          <option value="1">1</option>
          <option value="5">5</option>
          <option value="15">15</option>
          <option value="60">60</option>
          <option value="240">240</option>
          <option value="1D">1D</option>
        </select>

        <label className="text-sm text-slate-300">Candles</label>
        <input
          className="bg-slate-900 border border-slate-800 rounded px-2 py-1 w-28"
          type="number"
          min={120}
          max={3000}
          value={candles}
          onChange={(e) => setCandles(parseInt(e.target.value || '900', 10))}
        />

        <button className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1" onClick={refresh}>Atualizar</button>

        <label className="text-sm text-slate-300">GEX</label>
        <input type="checkbox" checked={gexOn} onChange={(e) => setGexOn(e.target.checked)} />

        <label className="text-sm text-slate-300">Expiry</label>
        <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
          {expiries.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>

        <div className="text-sm text-slate-400">Last: {last ?? '—'}</div>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <div className="text-sm text-slate-300 font-semibold">Chart</div>
          <div className="mt-3">
            <CandlesChart
              ohlc={ohlc}
              levels={gexOn ? gexLevels.map((x) => ({ price: x.strike, label: 'GEX', color: 'rgba(168, 85, 247, 0.6)' })) : []}
              onPickPrice={(p) => {
                if (!gexLevels.length) return;
                let best = gexLevels[0];
                let bestD = Math.abs(p - best.strike);
                for (const lv of gexLevels) {
                  const d = Math.abs(p - lv.strike);
                  if (d < bestD) {
                    best = lv;
                    bestD = d;
                  }
                }
                setSelectedStrike(best.strike);
              }}
            />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-semibold">Operacional (Long Strangle)</div>
            <div className="text-xs text-slate-500 mt-1">Clique no gráfico para selecionar o nível GEX mais próximo.</div>
            <div className="mt-3 text-sm">
              <div><span className="text-slate-400">Flip:</span> {flip ?? '—'}</div>
              <div><span className="text-slate-400">Strike selecionado:</span> {selectedStrike ?? '—'}</div>
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <label className="text-xs text-slate-400">Alvo (%)</label>
              <input className="bg-slate-900 border border-slate-800 rounded px-2 py-1 w-24" type="number" step="0.1" value={planTargetPct} onChange={(e)=>setPlanTargetPct(parseFloat(e.target.value||'1.5'))} />
            </div>
            <div className="mt-3 text-xs text-slate-300 bg-slate-950/40 border border-slate-800 rounded p-3">
              {selectedStrike ? (
                <>
                  <div className="font-semibold">Plano:</div>
                  <div>Comprar CALL + PUT no strike {selectedStrike} (expiry {expiry}).</div>
                  <div>Objetivo: capturar ~±{planTargetPct}% de variação do spot.</div>
                </>
              ) : (
                <div>Selecione um nível (ligue GEX e clique no gráfico).</div>
              )}
            </div>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-semibold">News</div>
            <div className="text-xs text-slate-500 mt-1">Próximo passo: lista + abrir dentro do sistema + análise (favorável/contra + ativos impactados).</div>
          </div>
        </div>
      </div>
    </main>
  );
}
