'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import styles from '@/components/grid.module.css';

const WGrid = WidthProvider(GridLayout);

type Item = {
  key: string;
  title: string;
  node: ReactNode;
};

const LS_KEY = 'desk.layout.v1';
const LS_EDIT = 'desk.layout.edit.v1';

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
  const [editMode, setEditMode] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setLayout(parsed);
      }
    } catch {
      // ignore
    }

    try {
      const em = localStorage.getItem(LS_EDIT);
      if (em === '1') setEditMode(true);
    } catch {
      // ignore
    }
  }, []);

  function onChange(l: Layout[]) {
    setLayout(l);
    // IMPORTANT: react-grid-layout may emit layout changes on responsive width
    // even when user isn't editing. Persist ONLY while in edit mode.
    if (!editMode) return;
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

  function toggleEdit() {
    const next = !editMode;
    setEditMode(next);
    try {
      localStorage.setItem(LS_EDIT, next ? '1' : '0');
    } catch {
      // ignore
    }

    // When locking (edit -> locked), persist current layout explicitly.
    if (!next) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(layout));
      } catch {
        // ignore
      }
    }
  }

  const byKey = new Map(items.map((it) => [it.key, it]));

  return (
    <div className={styles.root}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-xs text-slate-500">
          {editMode
            ? 'Modo edição ON: arraste pelo topo dos cards para mover · arraste o canto inferior direito para redimensionar.'
            : 'Layout travado. Ative o modo edição para mover/redimensionar os cards.'}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={
              editMode
                ? 'text-xs bg-amber-500/20 border border-amber-500/40 text-amber-200 rounded px-2 py-1 hover:border-amber-400'
                : 'text-xs bg-slate-950/40 border border-slate-800 text-slate-300 rounded px-2 py-1 hover:border-slate-600'
            }
            onClick={toggleEdit}
          >
            {editMode ? 'travar layout' : 'editar layout'}
          </button>
          <button className="text-xs text-slate-400 hover:text-slate-200" onClick={reset}>
            reset
          </button>
        </div>
      </div>

      <WGrid
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={32}
        onLayoutChange={onChange}
        draggableHandle={editMode ? '.drag-handle' : undefined}
        isDraggable={editMode}
        isResizable={editMode}
        compactType={null}
        preventCollision={true}
      >
        {layout.map((l) => {
          const it = byKey.get(l.i);
          if (!it) return null;
          return (
            <div key={it.key} className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              <div className={`drag-handle px-3 py-2 border-b border-slate-800 flex items-center justify-between ${editMode ? 'cursor-move' : 'cursor-default'}`}>
                <div className="text-xs font-semibold text-slate-200">{it.title}</div>
                <div className="text-[10px] text-slate-500">{editMode ? 'drag' : 'locked'}</div>
              </div>
              <div className="p-3 h-[calc(100%-36px)]">{it.node}</div>
            </div>
          );
        })}
      </WGrid>
    </div>
  );
}
