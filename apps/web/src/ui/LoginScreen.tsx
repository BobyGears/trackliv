import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { Panel } from './kit';
import { DteLogo } from './DteLogo';
import { LangToggle } from './TopBar';
import { t, tx } from '../lib/i18n';

export function LoginScreen() {
  const login = useStore((s) => s.login);
  const atlas = useStore((s) => s.authProvider === 'atlas');
  const atlasUrl = useStore((s) => s.atlasUrl);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('trackliv:user') ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await login(name, password));
    setBusy(false);
  };

  return (
    <div className="relative grid h-full place-items-center overflow-hidden bg-bg p-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(60rem 40rem at 20% 10%, color-mix(in srgb, var(--primary) 14%, transparent), transparent), radial-gradient(50rem 40rem at 90% 90%, color-mix(in srgb, var(--violet) 12%, transparent), transparent)',
        }}
      />
      <div className="absolute right-4 top-4">
        <LangToggle />
      </div>
      <Panel className="fade-in relative w-[360px] p-6 shadow-float">
        <div className="flex items-center gap-2.5">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-[#4f86ff] to-[#1f4fd6] shadow-[0_4px_12px_-2px_rgb(47_107_255/0.5)]">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <path d="M16 5 27 11.3 16 17.6 5 11.3z" fill="#fff" />
              <path d="M5 14.5 14.6 20v9.5L5 24z" fill="#fff" opacity=".85" />
              <path d="M27 14.5 17.4 20v9.5L27 24z" fill="#fff" opacity=".6" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-[18px] font-bold tracking-tight">TrackLiv</div>
            <div className="text-[11.5px] text-muted">{t('Dispatch')}</div>
          </div>
          <DteLogo className="ml-auto h-11 w-auto" />
        </div>
        {atlas && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12px] text-ink-2">
            <ShieldCheck size={15} className="shrink-0 text-primary" />
            <span>{t('Sign in with your Registra Atlas account')}</span>
          </div>
        )}
        <form onSubmit={submit} className={atlas ? 'mt-4 space-y-3' : 'mt-6 space-y-3'}>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-ink-2">{atlas ? t('E-mail') : t('Name')}</span>
            <input
              autoFocus={!name}
              type={atlas ? 'email' : 'text'}
              autoComplete="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-lg border border-line-strong bg-panel-solid px-3 text-[13.5px] outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-ink-2">{t('Password')}</span>
            <input
              autoFocus={!!name}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-lg border border-line-strong bg-panel-solid px-3 text-[13.5px] outline-none focus:border-primary"
            />
          </label>
          {error && <div className="rounded-lg bg-danger-weak px-3 py-2 text-[12px] font-medium text-danger">{tx(error)}</div>}
          <button
            type="submit"
            disabled={busy || !name || !password}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13.5px] font-semibold text-white shadow-sm hover:bg-primary-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}{' '}{t('Sign in')}
          </button>
        </form>
        {atlas ? (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-subtle">
            {t('Same e-mail and password as in Atlas.')}{' '}
            {atlasUrl && (
              <a href={atlasUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                {t('Forgot your password? Reset it in Atlas')}
              </a>
            )}
          </p>
        ) : (
          <p className="mt-4 text-center text-[11px] text-subtle">{t('Accounts are managed by your TrackLiv administrator.')}</p>
        )}
      </Panel>
    </div>
  );
}
