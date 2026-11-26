
import { ReactNode, useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export function Badge({
  children,
  color = 'zinc',
}: {
  children: ReactNode;
  color?: 'zinc' | 'emerald' | 'amber' | 'red' | 'blue';
}) {
  const colors = {
    zinc: 'bg-zinc-800 text-zinc-300 ring-zinc-700',
    emerald: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
    red: 'bg-red-500/15 text-red-400 ring-red-500/30',
    blue: 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colors[color]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-16 text-center">
      <div className="mb-3 text-zinc-600">{icon}</div>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500"
      style={{ width: size, height: size }}
    />
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------- TOAST NOTIFICATION SYSTEM ----------------
export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

type ToastListener = (toasts: ToastMessage[]) => void;
let toasts: ToastMessage[] = [];
let listeners: ToastListener[] = [];

function emitChange() {
  listeners.forEach((listener) => listener([...toasts]));
}

export const toast = {
  show(message: string, type: ToastType = 'info', duration = 3500) {
    const id = Math.random().toString(36).slice(2, 9);
    toasts.push({ id, type, message });
    emitChange();
    if (duration > 0) {
      setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id);
        emitChange();
      }, duration);
    }
  },
  success(message: string, duration?: number) {
    this.show(message, 'success', duration);
  },
  error(message: string, duration?: number) {
    this.show(message, 'error', duration);
  },
  info(message: string, duration?: number) {
    this.show(message, 'info', duration);
  },
  dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    emitChange();
  },
};

export function ToastContainer() {
  const [activeToasts, setActiveToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listeners.push(setActiveToasts);
    return () => {
      listeners = listeners.filter((l) => l !== setActiveToasts);
    };
  }, []);

  if (activeToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 sm:bottom-5 z-50 flex flex-col gap-2.5 max-w-sm w-auto sm:w-full pointer-events-none">
      {activeToasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-xl border p-3.5 shadow-2xl backdrop-blur-md transition-all duration-200 ${
            t.type === 'success'
              ? 'border-emerald-500/30 bg-zinc-900/95 text-emerald-300'
              : t.type === 'error'
              ? 'border-red-500/30 bg-zinc-900/95 text-red-300'
              : 'border-zinc-700 bg-zinc-900/95 text-zinc-200'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {t.type === 'success' && <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />}
            {t.type === 'error' && <AlertCircle size={18} className="text-red-400 mt-0.5 shrink-0" />}
            {t.type === 'info' && <Info size={18} className="text-blue-400 mt-0.5 shrink-0" />}
            <span className="text-xs sm:text-sm font-medium leading-snug break-words text-zinc-200">{t.message}</span>
          </div>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="text-zinc-500 hover:text-zinc-200 p-0.5 rounded transition-colors shrink-0"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
