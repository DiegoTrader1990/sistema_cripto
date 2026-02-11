'use client';

import GridDeskLayout from '@/components/GridDeskLayout';

export default function ResponsiveDeskLayout({
  view,
  mobileTab,
  setMobileTab,
  chart,
  chain,
  ops,
  paper,
  planner,
}: {
  view: 'DESKTOP' | 'TABLET' | 'MOBILE';
  mobileTab: 'CHART' | 'CHAIN' | 'PLANNER' | 'PAPER' | 'OPS';
  setMobileTab: (t: 'CHART' | 'CHAIN' | 'PLANNER' | 'PAPER' | 'OPS') => void;
  chart: React.ReactNode;
  chain: React.ReactNode;
  ops: React.ReactNode;
  paper: React.ReactNode;
  planner: React.ReactNode;
}) {
  if (view === 'MOBILE') {
    const tabs: Array<[typeof mobileTab, string]> = [
      ['CHART', 'Chart'],
      ['CHAIN', 'Chain'],
      ['PLANNER', 'Planner'],
      ['PAPER', 'Paper'],
      ['OPS', 'Ops'],
    ];

    const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
      <div className="mt-4 bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs font-semibold">{title}</div>
        </div>
        <div className="p-3">{children}</div>
      </div>
    );

    return (
      <div>
        <div className="mt-4 flex gap-2 flex-wrap">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              className={
                mobileTab === k
                  ? 'text-xs bg-blue-600 text-white rounded px-3 py-2'
                  : 'text-xs bg-slate-900/60 border border-slate-800 text-slate-200 rounded px-3 py-2'
              }
              onClick={() => setMobileTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {mobileTab === 'CHART' ? <Card title="Chart">{chart}</Card> : null}
        {mobileTab === 'CHAIN' ? <Card title="Chain">{chain}</Card> : null}
        {mobileTab === 'PLANNER' ? <Card title="Planner">{planner}</Card> : null}
        {mobileTab === 'PAPER' ? <Card title="Paper">{paper}</Card> : null}
        {mobileTab === 'OPS' ? <Card title="Operacional">{ops}</Card> : null}
      </div>
    );
  }

  if (view === 'TABLET') {
    return (
      <div className="mt-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs font-semibold">Chart</div>
            </div>
            <div className="p-3">{chart}</div>
          </div>

          <div className="mt-4 bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs font-semibold">Chain</div>
            </div>
            <div className="p-3">{chain}</div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs font-semibold">Operacional</div>
            </div>
            <div className="p-3">{ops}</div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs font-semibold">Estratégia / Planner</div>
            </div>
            <div className="p-3">{planner}</div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs font-semibold">Caixa / Simulador</div>
            </div>
            <div className="p-3">{paper}</div>
          </div>
        </div>
      </div>
    );
  }

  // DESKTOP
  return (
    <div className="mt-6">
      <GridDeskLayout
        hideToolbar
        items={[
          { key: 'chart', title: 'Chart', node: chart },
          { key: 'chain', title: 'Chain (CALL | STRIKE | PUT)', node: chain },
          { key: 'ops', title: 'Operacional (Long Strangle)', node: ops },
          { key: 'paper', title: 'Caixa / Simulador', node: paper },
          { key: 'news', title: 'Estratégia / Planner', node: planner },
        ]}
      />
    </div>
  );
}
