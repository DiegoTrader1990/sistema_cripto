'use client';

import { useEffect, useState } from 'react';

const LS_EDIT = 'desk.layout.edit.v1';

function emit(action: 'toggle' | 'reset') {
  try {
    window.dispatchEvent(new CustomEvent('desk_layout', { detail: { action } }));
  } catch {
    // ignore
  }
}

export default function DeskLayoutControls() {
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    try {
      setEditMode(localStorage.getItem(LS_EDIT) === '1');
    } catch {
      // ignore
    }
  }, []);

  function toggle() {
    const next = !editMode;
    setEditMode(next);
    try {
      localStorage.setItem(LS_EDIT, next ? '1' : '0');
    } catch {
      // ignore
    }
    emit('toggle');
  }

  function reset() {
    emit('reset');
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className={
          editMode
            ? 'text-xs bg-amber-500/20 border border-amber-500/40 text-amber-200 rounded px-2 py-1 hover:border-amber-400'
            : 'text-xs bg-slate-900 border border-slate-800 text-slate-200 rounded px-2 py-1 hover:border-slate-600'
        }
        onClick={toggle}
      >
        {editMode ? 'travar layout' : 'editar layout'}
      </button>
      <button className="text-xs bg-slate-900 border border-slate-800 text-slate-200 rounded px-2 py-1 hover:border-slate-600" onClick={reset}>
        reset
      </button>
    </div>
  );
}
