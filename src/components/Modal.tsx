import { ReactNode } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from './Field';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, title, onClose, children, size = 'md' }: ModalProps) {
  if (!open) return null;
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-3 sm:p-6 md:p-8">
      <div
        className={`relative w-full ${width} max-h-[92vh] flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40 my-auto`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 sm:px-6 py-3.5 sm:py-4 shrink-0">
          <h3 className="text-base sm:text-lg font-semibold text-zinc-100 truncate pr-2">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 shrink-0 cursor-pointer"
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  confirmVariant = 'danger',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  if (!open) return null;
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-400 shrink-0 mt-0.5">
            <AlertTriangle size={18} />
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
