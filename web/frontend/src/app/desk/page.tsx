'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

type Ohlc = { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };

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
  const [ohlc, setOhlc] = useState<Ohlc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const data = await apiGet(`/api/desk/ohlc?instrument=${encodeURIComponent(instrument)}&tf=${encodeURIComponent(tf)}&candles=${candles}`);
      setOhlc(data.ohlc);
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

        <div className="text-sm text-slate-400">Last: {last ?? '—'}</div>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <div className="text-sm text-slate-300 font-semibold">Chart (placeholder)</div>
          <div className="text-xs text-slate-500 mt-1">Próximo passo: colocar TradingView Lightweight Charts com eixo de preço à direita + candles + crosshair.</div>
          <pre className="mt-3 text-xs overflow-auto max-h-[420px] bg-slate-950/60 border border-slate-800 rounded p-3">
{JSON.stringify({ n: ohlc?.t?.length || 0, t0: ohlc?.t?.[0], t1: ohlc?.t?.[ohlc?.t?.length - 1], last }, null, 2)}
          </pre>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-semibold">Cards</div>
            <div className="text-xs text-slate-500 mt-1">Vamos reorganizar e replicar os cards do desktop (Context / Level / Strategy / Planner) aqui.</div>
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
