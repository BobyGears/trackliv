import clsx from 'clsx';
import type { Person } from '@trackliv/core';
import { initials } from '@trackliv/core';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Tone } from '../lib/format';

export const cx = clsx;

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('glass rounded-2xl', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between', className)}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">{children}</div>
      {right}
    </div>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: 'bg-panel-3 text-ink-2',
  primary: 'bg-primary-weak text-primary',
  success: 'bg-success-weak text-success',
  warning: 'bg-warning-weak text-warning',
  danger: 'bg-danger-weak text-danger',
  violet: 'bg-violet-weak text-violet',
  cyan: 'bg-cyan-weak text-cyan',
};

export function Pill({ tone = 'neutral', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] text-[11px] font-semibold', toneClass[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'violet';
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[11.5px]' : 'h-8 px-3 text-[12.5px]',
        variant === 'primary' && 'bg-primary text-white shadow-sm hover:bg-primary-2',
        variant === 'violet' && 'bg-violet text-white shadow-sm hover:opacity-90',
        variant === 'secondary' && 'border border-line-strong bg-panel-solid text-ink hover:bg-panel-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-panel-3',
        variant === 'danger' && 'bg-danger-weak text-danger hover:opacity-80',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string; size?: 'sm' | 'md' }
>(function IconButton({ active, label, size = 'md', className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      className={cx(
        'grid shrink-0 place-items-center rounded-lg transition-colors',
        size === 'sm' ? 'size-7' : 'size-8',
        active ? 'bg-primary-weak text-primary' : 'text-ink-2 hover:bg-panel-3',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

const AVATAR_COLORS = ['#2f6bff', '#12a150', '#d9820b', '#7c5cff', '#0ea5b7', '#e5484d', '#d6409f', '#8e4ec6', '#46a758', '#a18072'];
export function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ person, size = 24, ring }: { person: Person; size?: number; ring?: string }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: avatarColor(person.id),
        boxShadow: ring ? `0 0 0 2px var(--panel-solid), 0 0 0 3.5px ${ring}` : '0 0 0 2px var(--panel-solid)',
        opacity: person.status === 'available' ? 1 : 0.55,
      }}
      title={`${person.firstName} ${person.lastName}`}
    >
      {initials(person)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 22 }: { people: Person[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar person={p} size={size} />
        </span>
      ))}
      {people.length > max && <span className="ml-1 text-[11px] text-muted">+{people.length - max}</span>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function Prop({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line py-1 last:border-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={cx('min-w-0 truncate text-right font-medium text-ink', mono && 'mono text-[12px]')}>{children}</span>
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span>
        <span className="block font-medium text-ink">{label}</span>
        {hint && <span className="block text-[11.5px] text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-panel-3 ring-1 ring-line-strong')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg bg-panel-3 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-md font-semibold transition-all',
            size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
            value === o.value ? 'bg-panel-solid text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, tone = 'success' }: { value: number; tone?: Tone }) {
  const color = { neutral: 'var(--subtle)', primary: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', violet: 'var(--violet)', cyan: 'var(--cyan)' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-3">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      {icon && <div className="text-subtle">{icon}</div>}
      <div className="font-semibold text-ink-2">{title}</div>
      {hint && <div className="max-w-64 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function LicenseChips({ licenses }: { licenses: string[] }) {
  if (!licenses.length) return <span className="text-[11px] text-subtle">no licence</span>;
  return (
    <span className="inline-flex gap-0.5">
      {licenses.map((l) => (
        <span key={l} className="mono rounded border border-line-strong px-1 text-[10px] font-semibold leading-4 text-ink-2">
          {l}
        </span>
      ))}
    </span>
  );
}
