'use client';

import { useMemo } from 'react';

function pct(a: number, b: number) {
  if (!b) return 0;
  return (a / b - 1) * 100;
}

export default function SpotPulseCard({
  spot,
  selectedStrike,
  flip,
  targetPct,
  distArmPct = 0.35,
  distExecPct = 0.08,
}: {
  spot: number;
  selectedStrike: number | null;
  flip: number | null;
  targetPct: number;
  distArmPct?: number;
  distExecPct?: number;
}) {
  const distPct = useMemo(() => {
    if (!spot || !selectedStrike) return null;
    return pct(Number(selectedStrike), Number(spot));
  }, [spot, selectedStrike]);

  const state = useMemo(() => {
    if (!spot || !selectedStrike || distPct == null) return { tag: 'SELECIONE', detail: 'Escolha uma wall/strike' };
    const d = Math.abs(distPct);
    if (d <= distExecPct) return { tag: 'EXECUTAR', detail: `Muito próximo (≤ ${distExecPct.toFixed(2)}%)` };
    if (d <= distArmPct) return { tag: 'ARMADO', detail: `Na zona (≤ ${distArmPct.toFixed(2)}%)` };
    return { tag: 'AGUARDAR', detail: 'Aguardando aproximar' };
  }, [spot, selectedStrike, distPct, distArmPct, distExecPct]);

  const badge = (tag: string) => {
    if (tag === 'EXECUTAR') return 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-200';
    if (tag === 'ARMADO') return 'bg-amber-500/20 border border-amber-500/40 text-amber-200';
    if (tag === 'AGUARDAR') return 'bg-slate-950/40 border border-slate-800 text-slate-300';
    return 'bg-slate-950/40 border border-slate-800 text-slate-400';
  };

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-200">Spot Pulse</div>
        <div className={`text-[11px] px-2 py-1 rounded ${badge(state.tag)}`}>{state.tag}</div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <div className="text-[11px] text-slate-400">Spot</div>
          <div className="text-sm font-semibold">{spot ? Number(spot).toFixed(0) : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">Wall/Strike</div>
          <div className="text-sm font-semibold">{selectedStrike ? Number(selectedStrike).toFixed(0) : '—'}</div>
          <div className={`text-[11px] ${distPct != null && distPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{distPct == null ? '—' : `${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}%`}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">Target</div>
          <div className="text-sm font-semibold">±{Number(targetPct || 0).toFixed(2)}%</div>
          <div className="text-[11px] text-slate-500">flip: {flip == null ? '—' : Number(flip).toFixed(0)}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{state.detail}</div>
    </div>
  );
}
