'use client';

import type { ReactNode } from 'react';

export default function PremiumDeskLayout({
  view,
  chart,
  selection,
  options,
  simulator,
  operator,
}: {
  view: 'DESKTOP' | 'TABLET' | 'MOBILE';
  chart: ReactNode;
  selection: ReactNode;
  options: ReactNode;
  simulator: ReactNode;
  operator: ReactNode;
}) {
  const Card = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs font-semibold">{title}</div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );

  if (view === 'MOBILE') {
    return (
      <div className="mt-6 space-y-4">
        <Card title="Chart (GEX)">{chart}</Card>
        <Card title="Seleção / Entrada">{selection}</Card>
        <Card title="Opções / Análise">{options}</Card>
        <Card title="Operador (Bot)">{operator}</Card>
        <Card title="Simulador">{simulator}</Card>
      </div>
    );
  }

  if (view === 'TABLET') {
    return (
      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7 space-y-4">
          <Card title="Chart (GEX)">{chart}</Card>
          <Card title="Seleção / Entrada">{selection}</Card>
          <Card title="Opções / Análise">{options}</Card>
        </div>
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <Card title="Operador (Bot)">{operator}</Card>
          <Card title="Simulador">{simulator}</Card>
        </div>
      </div>
    );
  }

  // DESKTOP (fixo, sem drag)
  return (
    <div className="mt-6 grid grid-cols-12 gap-4">
      <div className="col-span-12 xl:col-span-7 space-y-4">
        <Card title="Chart (GEX)">{chart}</Card>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-6">
            <Card title="Seleção / Entrada">{selection}</Card>
          </div>
          <div className="col-span-12 lg:col-span-6">
            <Card title="Opções / Análise">{options}</Card>
          </div>
        </div>
      </div>
      <div className="col-span-12 xl:col-span-5 space-y-4">
        <Card title="Operador (Bot)">{operator}</Card>
        <Card title="Simulador">{simulator}</Card>
      </div>
    </div>
  );
}
