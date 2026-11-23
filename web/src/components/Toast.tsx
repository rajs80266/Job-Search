import { useEffect } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  undo?: () => void;
}

const TOAST_MS = 7000;

export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastId, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2"
    >
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex animate-toast-in items-center gap-3 rounded-sm bg-ink px-4 py-2 text-sm text-white shadow-lg"
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                onDismiss();
              }}
              className="rounded-sm font-semibold text-accent-soft underline underline-offset-2 hover:text-white"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
