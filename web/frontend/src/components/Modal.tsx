'use client';

import { ReactNode, useEffect } from 'react';

export default function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="text-sm font-semibold text-slate-100 truncate">{title}</div>
          <button className="text-slate-300 hover:text-white text-sm" onClick={onClose}>
            Fechar (Esc)
          </button>
        </div>
        <div className="p-4 overflow-auto max-h-[calc(85vh-52px)]">{children}</div>
      </div>
    </div>
  );
}
