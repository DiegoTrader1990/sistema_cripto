'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import GridLayout, { Layout, WidthProvider } from 'react-grid-layout';

const WGrid = WidthProvider(GridLayout);

type Item = {
  key: string;
  title: string;
  node: ReactNode;
};

const LS_KEY = 'desk.layout.v1';

export default function GridDeskLayout({ items }: { items: Item[] }) {
  const defaultLayout: Layout[] = useMemo(
    () => [
      { i: 'chart', x: 0, y: 0, w: 7, h: 12 },
      { i: 'ops', x: 7, y: 0, w: 5, h: 8 },
      { i: 'paper', x: 7, y: 8, w: 5, h: 7 },
      { i: 'chain', x: 0, y: 12, w: 7, h: 7 },
      { i: 'news', x: 0, y: 19, w: 12, h: 4 },
    ],
    []
  );

  const [layout, setLayout] = useState<Layout[]>(defaultLayout);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLayout(parsed);
    } catch {
      // ignore
    }
  }, []);

  function onChange(l: Layout[]) {
    setLayout(l);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(l));
    } catch {
      // ignore
    }
  }

  function reset() {
    setLayout(defaultLayout);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(defaultLayout));
    } catch {
      // ignore
    }
  }

  const byKey = new Map(items.map((it) => [it.key, it]));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-500">
          Dica: arraste pelo topo dos cards para mover · arraste a borda inferior direita para redimensionar.
        </div>
        <button className="text-xs text-slate-400 hover:text-slate-200" onClick={reset}>
          reset layout
        </button>
      </div>

      <WGrid
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={32}
        onLayoutChange={onChange}
        draggableHandle=".drag-handle"
        compactType={null}
        preventCollision={true}
      >
        {layout.map((l) => {
          const it = byKey.get(l.i);
          if (!it) return null;
          return (
            <div key={it.key} className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="drag-handle px-3 py-2 border-b border-slate-800 flex items-center justify-between cursor-move">
                <div className="text-xs font-semibold text-slate-200">{it.title}</div>
                <div className="text-[10px] text-slate-500">drag</div>
              </div>
              <div className="p-3 h-[calc(100%-36px)]">{it.node}</div>
            </div>
          );
        })}
      </WGrid>
    </div>
  );
}
