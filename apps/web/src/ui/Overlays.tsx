import { AlertTriangle, CheckCircle2, Crosshair, Info, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { EventList } from './OpsTable';
import { Button, IconButton, Panel, Segmented, cx } from './kit';
import { t, tx } from '../lib/i18n';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed left-1/2 top-[76px] z-[90] flex w-[380px] -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="glass fade-in pointer-events-auto flex items-start gap-2.5 rounded-xl px-3 py-2.5 shadow-float">
          <span className="mt-0.5">
            {toast.kind === 'success' && <CheckCircle2 size={16} className="text-success" />}
            {toast.kind === 'info' && <Info size={16} className="text-primary" />}
            {toast.kind === 'warning' && <AlertTriangle size={16} className="text-warning" />}
            {toast.kind === 'error' && <XCircle size={16} className="text-danger" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-snug">{tx(toast.title)}</div>
            {toast.detail && <div className="text-[12px] text-muted">{tx(toast.detail)}</div>}
          </div>
          {toast.action && (
            <button
              className="text-[12px] font-semibold text-primary hover:underline"
              onClick={() => {
                toast.action!.run();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="text-subtle hover:text-ink" onClick={() => dismiss(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

type EventFilter = 'all' | 'alerts' | 'stages' | 'changes';

export function EventsDrawer() {
  const open = useStore((s) => s.eventsOpen);
  const events = useStore((s) => s.events);
  const setOpen = useStore((s) => s.setEventsOpen);
  const [filter, setFilter] = useState<EventFilter>('all');
  if (!open) return null;
  const list = events.filter((e) =>
    filter === 'all' ? true : filter === 'alerts' ? e.severity === 'warning' || e.severity === 'critical' : filter === 'stages' ? e.kind === 'stage' : e.kind === 'assignment' || e.kind === 'randomize',
  );
  return (
    <Panel className="fade-in pointer-events-auto absolute bottom-3 right-3 top-[76px] z-40 flex w-[380px] flex-col overflow-hidden shadow-float">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="flex-1">
          <div className="text-[14px] font-bold">{t('Event log')}</div>
          <div className="text-[11px] text-muted">{t('Geofence stages, alerts and every plan change (audit trail)')}</div>
        </div>
        <IconButton size="sm" label={t('Close')} onClick={() => setOpen(false)}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="border-b border-line px-3 py-2">
        <Segmented<EventFilter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('All') },
            { value: 'alerts', label: t('Alerts') },
            { value: 'stages', label: t('Stages') },
            { value: 'changes', label: t('Changes') },
          ]}
        />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        <EventList events={list} />
      </div>
    </Panel>
  );
}

export function MapPickBanner() {
  const pick = useStore((s) => s.mapPick);
  if (!pick) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[76px] z-40 flex justify-center">
      <div className="glass fade-in pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-3 pr-1.5 shadow-float ring-2 ring-primary">
        <Crosshair size={16} className="text-primary" />
        <span className="font-semibold">{pick.label}</span>
        <Button size="sm" variant="ghost" onClick={() => useStore.getState().setMapPick(null)}>
          {t('Cancel')}{' '}<span className="text-subtle">{t('Esc')}</span>
        </Button>
      </div>
    </div>
  );
}

/** Global keyboard shortcuts. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        st.setPalette(!st.paletteOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (e.key === 'Escape') {
        if (st.paletteOpen) return st.setPalette(false);
        if (st.mapPick) return st.setMapPick(null);
        if (st.scenario) return st.discardScenario();
        if (st.eventsOpen) return st.setEventsOpen(false);
        if (st.selection) return st.select(null);
        return;
      }
      if (typing || mod || e.altKey || st.paletteOpen) return;
      if (e.key === '1') st.setView('map');
      else if (e.key === '2') st.setView('dispatch');
      else if (e.key === '3') st.setView('schedule');
      else if (e.key === '4') st.setView('data');
      else if (e.key === '/') {
        e.preventDefault();
        st.setPalette(true);
      } else if (e.key.toLowerCase() === 'r') {
        st.setView('dispatch');
        if (st.scenario) st.rerollScenario();
        else st.previewRandomize();
      } else if (e.key.toLowerCase() === 'f') {
        st.setView('map');
        st.requestFocus({ kind: 'fit-all' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  const ready = useStore((s) => s.ready);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (connected || !ready) return setShow(false);
    const timer = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(timer);
  }, [connected, ready]);
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[270px] z-50 flex justify-center">
      <div className={cx('glass rounded-full px-4 py-1.5 text-[12px] font-semibold text-danger shadow-float')}>{t('Live connection lost – reconnecting…')}</div>
    </div>
  );
}
