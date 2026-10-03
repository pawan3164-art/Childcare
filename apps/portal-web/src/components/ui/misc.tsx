import { type ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin text-muted', className)} size={20} />;
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner />
    </div>
  );
}

export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
    </div>
  );
}

export function Avatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-muted text-sm font-semibold text-primary">
      {initials}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-surface px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function StatTile({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  tone?: 'neutral' | 'primary' | 'warning' | 'danger';
}) {
  const toneClasses = {
    neutral: 'bg-muted-surface text-foreground',
    primary: 'bg-primary-muted text-primary',
    warning: 'bg-warning-surface text-warning',
    danger: 'bg-danger-surface text-danger',
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      {icon && <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', toneClasses)}>{icon}</div>}
      <div>
        <p className="text-2xl font-semibold leading-tight text-foreground">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </div>
  );
}
