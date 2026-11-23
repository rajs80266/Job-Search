import type { ReactNode } from "react";

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-sm border border-danger/40 bg-danger-soft p-4 text-danger">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-sm border border-danger/50 bg-surface px-3 py-1 text-sm font-medium hover:bg-danger-soft"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
