'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import CandlesChart, { type Ohlc } from '@/components/CandlesChart';
import PaperBoxCard from '@/components/PaperBoxCard';
import GridDeskLayout from '@/components/GridDeskLayout';
import DeskLayoutControls from '@/components/DeskLayoutControls';
import StrategyPlannerCard from '@/components/StrategyPlannerCard';
import SpotPulseCard from '@/components/SpotPulseCard';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

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
  const [liveOn, setLiveOn] = useState<boolean>(true);
  const [liveSec, setLiveSec] = useState<number>(8);
  const [ohlc, setOhlc] = useState<OhlcWithVol | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState<boolean>(true);

  // options/gex
  const [expiry, setExpiry] = useState<string>('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [gexOn, setGexOn] = useState<boolean>(true);
  const [gexMode, setGexMode] = useState<'ALL' | 'EXPIRY'>('ALL');
  const [gexLevels, setGexLevels] = useState<{ strike: number; gex: number }[]>([]);
  const [wallsN, setWallsN] = useState<number>(18);
  const [flip, setFlip] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [planTargetPct, setPlanTargetPct] = useState<number>(1.5);
  // chain state removed (unused)
  const [perStrike, setPerStrike] = useState<any[]>([]);
  const [strikeRangePct, setStrikeRangePct] = useState<number>(5);

  const [optErr, setOptErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    setOptErr(null);

    try {
      const data = await apiGet(
        `/api/desk/ohlc?instrument=${encodeURIComponent(instrument)}&tf=${encodeURIComponent(tf)}&candles=${candles}`
      );
      setOhlc(data.ohlc);
    } catch (e: any) {
      setErr(String(e?.message || e));
      if (String(e?.message || '').includes('unauthorized')) {
        localStorage.removeItem('token');
        r.push('/login');
      }
      setBootLoading(false);
      return;
    }

    // options/gex
    try {
      const ex = await apiGet(`/api/desk/expiries?currency=${instrument.startsWith('ETH') ? 'ETH' : 'BTC'}`);
      const exs = (ex.expiries || []) as string[];
      setExpiries(exs);
      const chosen = expiry || exs[0] || '';
      setExpiry(chosen);
      if (chosen) {
        const currency = instrument.startsWith('ETH') ? 'ETH' : 'BTC';

        // 1) Chain (execution pricing) is per-expiry (D1/D2/manual)
        const cg = await apiGet(`/api/desk/chain?currency=${currency}&expiry=${encodeURIComponent(chosen)}`);
        setFlip(cg.flip ?? null);
        const chainRows = cg.chain || [];

        // 2) Walls strength: ALL expiries (user requested)
        try {
          if (gexMode === 'ALL') {
            const all = await apiGet(`/api/desk/walls?currency=${currency}&mode=all&strike_range_pct=${encodeURIComponent(String(Math.max(8, strikeRangePct)))}`);
            setGexLevels((all.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
            setWallsN((all.walls || []).length || 18);
          } else {
            setGexLevels((cg.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
            setWallsN((cg.walls || []).length || 18);
          }
        } catch {
          // fallback to expiry walls
          setGexLevels((cg.walls || []).map((w: any) => ({ strike: Number(w.strike), gex: Number(w.gex) })));
          setWallsN((cg.walls || []).length || 18);
        }

        const ps = (cg.per_strike || []) as any[];
        if (ps && ps.length) {
          setPerStrike(ps);
        } else {
          const m = new Map<number, any>();
          for (const row of chainRows) {
            const k = Number(row.strike);
            if (!m.has(k)) m.set(k, { strike: k, call: null, put: null, net_gex: 0, call_gex: 0, put_gex: 0 });
            const it = m.get(k);
            if (row.option_type === 'call') it.call = row;
            if (row.option_type === 'put') it.put = row;
          }
          setPerStrike(Array.from(m.values()).sort((a, b) => a.strike - b.strike));
        }
      }
    } catch (e: any) {
      setOptErr(String(e?.message || e));
    } finally {
      setBootLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, tf, candles]);

  useEffect(() => {
    if (!liveOn) return;
    const ms = Math.max(3000, Math.min(60000, Number(liveSec || 8) * 1000));
    const t = setInterval(() => {
      refresh();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOn, liveSec, instrument, tf, candles, expiry, gexOn]);

  const last = useMemo(() => {
    if (!ohlc?.c?.length) return null;
    return ohlc.c[ohlc.c.length - 1];
  }, [ohlc]);

  const byStrike = useMemo(() => {
    const m = new Map<number, any>();
    for (const rr of perStrike || []) m.set(Number(rr.strike), rr);
    return m;
  }, [perStrike]);

  const strikeRows = useMemo(() => {
    const spot = last || 0;
    if (!spot) return Array.from(byStrike.values());
    const lo = spot * (1 - strikeRangePct / 100);
    const hi = spot * (1 + strikeRangePct / 100);
    return Array.from(byStrike.values()).filter((rr) => Number(rr.strike) >= lo && Number(rr.strike) <= hi);
  }, [byStrike, last, strikeRangePct]);

  const selected = useMemo(() => {
    if (!selectedStrike) return null;
    return byStrike.get(Number(selectedStrike)) || null;
  }, [byStrike, selectedStrike]);

  const maxAbsWall = useMemo(() => {
    let m = 0;
    for (const w of gexLevels || []) m = Math.max(m, Math.abs(Number(w.gex || 0)));
    return m || 1;
  }, [gexLevels]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold">My Friend Cripto</h1>
          <nav className="flex items-center gap-2">
            <a className="text-sm text-slate-400 hover:text-slate-200" href="/news">News</a>
            <a className="text-sm text-slate-400 hover:text-slate-200" href="/report">Relatório</a>
            <a className="text-sm text-slate-400 hover:text-slate-200" href="/help">Tutorial</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <DeskLayoutControls />
          <a className="text-sm bg-slate-900 border border-slate-800 rounded px-3 py-1 hover:border-slate-600" href="/login">Trocar login</a>
        </div>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      {bootLoading ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 w-[min(520px,90vw)]">
            <div className="text-lg font-bold">Aguarde My Friend…</div>
            <div className="mt-2 text-sm text-slate-300">Carregando mercado, opções, GEX e walls em tempo real.</div>
            <div className="mt-4 h-2 rounded bg-slate-800 overflow-hidden">
              <div className="h-2 w-1/2 bg-blue-600 animate-pulse" />
            </div>
            <div className="mt-3 text-xs text-slate-500">Se demorar, pode ser o Render “acordando”.</div>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <GridDeskLayout hideToolbar
          items={[
            {
              key: 'chart',
              title: 'Chart',
              node: (
                <div className="aspect-square relative">
                  <div className="absolute left-2 top-2 z-10 bg-slate-950/60 backdrop-blur border border-slate-800 rounded-xl px-2 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <select className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                        <option>BTC-PERPETUAL</option>
                        <option>ETH-PERPETUAL</option>
                      </select>
                      <select className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs" value={tf} onChange={(e) => setTf(e.target.value)}>
                        <option value="1">1m</option>
                        <option value="5">5m</option>
                        <option value="15">15m</option>
                        <option value="60">1h</option>
                        <option value="240">4h</option>
                        <option value="1D">1D</option>
                      </select>
                      <input className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs w-20" type="number" min={120} max={3000} value={candles} onChange={(e) => setCandles(parseInt(e.target.value || '900', 10))} />
                      <button className="bg-blue-600 hover:bg-blue-500 rounded px-2 py-1 text-xs" onClick={refresh}>Sync</button>
                    </div>

                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <label className="text-[11px] text-slate-300">Live</label>
                      <input type="checkbox" checked={liveOn} onChange={(e) => setLiveOn(e.target.checked)} />
                      <select className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs" value={liveSec} onChange={(e)=>setLiveSec(parseInt(e.target.value||'8',10))}>
                        <option value={4}>4s</option>
                        <option value={8}>8s</option>
                        <option value={15}>15s</option>
                      </select>

                      <label className="text-[11px] text-slate-300">GEX</label>
                      <input type="checkbox" checked={gexOn} onChange={(e) => setGexOn(e.target.checked)} />
                      <select className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs" value={gexMode} onChange={(e)=>setGexMode(e.target.value as any)} title="ALL = força real (todos expiries); EXPIRY = só vencimento selecionado">
                        <option value="ALL">ALL</option>
                        <option value="EXPIRY">EXPIRY</option>
                      </select>
                      <span className="text-[11px] text-slate-400">{gexLevels.length} walls</span>

                      <label className="text-[11px] text-slate-300">Expiry</label>
                      <select className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                        {expiries.map((e) => (
                          <option key={e} value={e}>{e}</option>
                        ))}
                      </select>

                      <label className="text-[11px] text-slate-300">Range%</label>
                      <input className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs w-16" type="number" min={1} max={30} step={1} value={strikeRangePct} onChange={(e) => setStrikeRangePct(parseFloat(e.target.value || '5'))} />

                      <span className="text-[11px] text-slate-400">Last: {last ?? '—'}</span>
                    </div>
                  </div>

                  <CandlesChart
                    className="w-full h-full"
                    ohlc={ohlc}
                    levels={
                      gexOn
                        ? [
                            ...(flip ? [{ price: Number(flip), label: 'FLIP', color: 'rgba(34, 197, 94, 0.75)' }] : []),
                            ...(selectedStrike
                              ? [{ price: Number(selectedStrike), label: 'SEL', color: 'rgba(59, 130, 246, 0.90)' }]
                              : []),
                            ...[...gexLevels]
                              .sort((a, b) => Math.abs(Number(b.gex || 0)) - Math.abs(Number(a.gex || 0)))
                              .slice(0, wallsN || 18)
                              .map((x, idx) => {
                                const s = Number(x.strike);
                                const sp = Number(last || 0);
                                const d = sp ? ((s / sp - 1) * 100) : 0;
                                const tag = sp ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}%` : '';
                                const g = Number(x.gex || 0);
                                const strength = Math.min(1, Math.abs(g) / maxAbsWall);
                                const alpha = 0.35 + 0.55 * strength;
                                const gShort = Math.abs(g) >= 1e6 ? `${(g / 1e6).toFixed(1)}M` : Math.abs(g) >= 1e3 ? `${(g / 1e3).toFixed(1)}k` : g.toFixed(0);
                                return { price: s, label: `#${idx + 1} ${tag} ${gShort}`.trim(), color: `rgba(168, 85, 247, ${alpha.toFixed(2)})` };
                              }),
                          ]
                        : []
                    }
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
              ),
            },
            {
              key: 'chain',
              title: 'Chain (CALL | STRIKE | PUT)',
              node: (
                <>
                  <div className="text-xs text-slate-500 mb-2">Rows: {strikeRows.length} (range ±{strikeRangePct}%)</div>
                  <div className="overflow-auto max-h-[380px] border border-slate-800 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-950 border-b border-slate-800">
                        <tr>
                          <th className="text-left p-2">Call (bid/ask · IV · OI)</th>
                          <th className="text-left p-2">Strike</th>
                          <th className="text-left p-2">Put (bid/ask · IV · OI)</th>
                          <th className="text-left p-2">NetGEX</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strikeRows.map((rr: any) => (
                          <tr
                            key={rr.strike}
                            className={`border-b border-slate-900 hover:bg-slate-900/40 cursor-pointer ${selectedStrike === rr.strike ? 'bg-slate-900/50' : ''}`}
                            onClick={() => setSelectedStrike(Number(rr.strike))}
                          >
                            <td className="p-2 text-slate-200">
                              {rr.call?.bid_price ?? '—'} / {rr.call?.ask_price ?? '—'} · {rr.call?.mark_iv ?? '—'} · {rr.call?.open_interest ?? '—'}
                            </td>
                            <td className="p-2 text-slate-100 font-semibold">{Number(rr.strike).toFixed(0)}</td>
                            <td className="p-2 text-slate-200">
                              {rr.put?.bid_price ?? '—'} / {rr.put?.ask_price ?? '—'} · {rr.put?.mark_iv ?? '—'} · {rr.put?.open_interest ?? '—'}
                            </td>
                            <td className="p-2 text-slate-400">{Number(rr.net_gex || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ),
            },
            {
              key: 'ops',
              title: 'Operacional (Long Strangle)',
              node: (
                <div>
                  <SpotPulseCard spot={Number(last || 0)} selectedStrike={selectedStrike} flip={flip} targetPct={planTargetPct} />
                  <div className="mt-3 text-xs text-slate-500">Clique no gráfico para selecionar o nível GEX mais próximo. Se o clique não funcionar, use a lista de níveis abaixo.</div>
                  {optErr ? <div className="mt-2 text-xs text-amber-400">GEX/Chain: {optErr}</div> : null}

                  <div className="mt-3">
                    <div className="text-xs text-slate-400">Níveis (walls):</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[...gexLevels]
                        .sort((a, b) => Math.abs(Number(b.gex || 0)) - Math.abs(Number(a.gex || 0)))
                        .slice(0, 10)
                        .map((lv, idx) => {
                          const sp = Number(last || 0);
                          const s = Number(lv.strike);
                          const d = sp ? ((s / sp - 1) * 100) : 0;
                          const g = Number(lv.gex || 0);
                          const gShort = Math.abs(g) >= 1e6 ? `${(g / 1e6).toFixed(1)}M` : Math.abs(g) >= 1e3 ? `${(g / 1e3).toFixed(1)}k` : g.toFixed(0);
                          return (
                            <button
                              key={lv.strike}
                              className={`text-xs bg-slate-950/40 border border-slate-800 rounded px-2 py-1 hover:border-slate-600 ${selectedStrike === s ? 'border-blue-500/60' : ''}`}
                              onClick={() => setSelectedStrike(s)}
                              title={`rank #${idx + 1} |gex|=${Math.abs(g).toFixed(2)} dist=${d.toFixed(2)}%`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">#{idx + 1}</span>
                                <span className="text-slate-300">{s.toFixed(0)}</span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-500">
                                <span>{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span>
                                <span>{gShort}</span>
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  <div className="mt-3 text-sm">
                    <div>
                      <span className="text-slate-400">Flip:</span> {flip ?? '—'}
                    </div>
                    <div>
                      <span className="text-slate-400">Strike selecionado:</span> {selectedStrike ?? '—'}
                    </div>
                    {selected ? (
                      <div className="mt-2 text-xs text-slate-300 bg-slate-950/40 border border-slate-800 rounded p-3">
                        <div className="font-semibold">Detalhes do Strike</div>
                        <div className="mt-1">Net GEX: {Number(selected.net_gex || 0).toFixed(2)}</div>
                        <div>
                          Call: bid {selected.call?.bid_price ?? '—'} / ask {selected.call?.ask_price ?? '—'} / IV {selected.call?.mark_iv ?? '—'} / OI {selected.call?.open_interest ?? '—'}
                        </div>
                        <div>
                          Put: bid {selected.put?.bid_price ?? '—'} / ask {selected.put?.ask_price ?? '—'} / IV {selected.put?.mark_iv ?? '—'} / OI {selected.put?.open_interest ?? '—'}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-slate-400">Alvo (%)</label>
                    <input
                      className="bg-slate-900 border border-slate-800 rounded px-2 py-1 w-24"
                      type="number"
                      step="0.1"
                      value={planTargetPct}
                      onChange={(e) => setPlanTargetPct(parseFloat(e.target.value || '1.5'))}
                    />
                  </div>

                  <div className="mt-3 text-xs text-slate-300 bg-slate-950/40 border border-slate-800 rounded p-3">
                    {selectedStrike ? (
                      <>
                        <div className="font-semibold">Plano:</div>
                        <div>
                          Comprar CALL + PUT no strike {selectedStrike} (expiry {expiry}).
                        </div>
                        <div>Objetivo: capturar ~±{planTargetPct}% de variação do spot.</div>
                      </>
                    ) : (
                      <div>Selecione um nível (ligue GEX e clique no gráfico).</div>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: 'paper',
              title: 'Caixa / Simulador',
              node: (
                <PaperBoxCard
                  selected={selectedStrike ? { strike: Number(selectedStrike), ...(selected || {}) } : null}
                  expiry={expiry}
                  spot={Number(last || 0)}
                  targetPct={planTargetPct}
                />
              ),
            },
            {
              key: 'news',
              title: 'Estratégia / Planner',
              node: (
                <StrategyPlannerCard
                  selectedStrike={selectedStrike}
                  selected={selectedStrike ? { strike: Number(selectedStrike), ...(selected || {}) } : null}
                  expiry={expiry}
                  expiries={expiries}
                  setExpiry={setExpiry}
                  spot={Number(last || 0)}
                  targetPct={planTargetPct}
                  setTargetPct={setPlanTargetPct}
                />
              ),
            },
          ]}
        />
      </div>
    </main>
  );
}
