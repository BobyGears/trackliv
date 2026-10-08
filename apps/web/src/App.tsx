import { useEffect } from 'react';
import { useStore } from './lib/store';
import { MapView } from './map/MapView';
import { CommandPalette } from './ui/CommandPalette';
import { DataView } from './ui/DataView';
import { DispatchBoard } from './ui/DispatchBoard';
import { LoginScreen } from './ui/LoginScreen';
import { KpiCards } from './ui/KpiCards';
import { MapControls } from './ui/MapControls';
import { ObjectPanel } from './ui/ObjectPanel';
import { OpsTable } from './ui/OpsTable';
import { ConnectionBanner, EventsDrawer, MapPickBanner, Toasts, useShortcuts } from './ui/Overlays';
import { ScheduleView } from './ui/ScheduleView';
import { TopBar } from './ui/TopBar';
import { TrackingCard } from './ui/TrackingCard';

export function App() {
  const auth = useStore((s) => s.auth);
  const ready = useStore((s) => s.ready);
  const error = useStore((s) => s.error);
  const theme = useStore((s) => s.theme);
  const view = useStore((s) => s.view);
  useShortcuts();
  useEffect(() => {
    void useStore.getState().checkAuth();
  }, []);
  useEffect(() => {
    if (auth === 'ok' && !ready) void useStore.getState().init();
  }, [auth, ready]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0f16' : '#eaeef4');
  }, [theme]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <div className="text-[15px] font-semibold text-danger">TrackLiv could not reach its server</div>
          <div className="mt-1 text-muted">{error}</div>
          <div className="mt-3 text-[12px] text-subtle">
            Start it with <code className="mono">npm run dev</code> and reload.
          </div>
        </div>
      </div>
    );
  }
  if (auth === 'signed-out') return <LoginScreen />;
  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-3 text-muted">
          <span className="size-2 animate-pulse rounded-full bg-primary" /> Loading TrackLiv…
        </div>
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView />
      <div className="pointer-events-none absolute inset-0">
        <TopBar />
        {view === 'map' && (
          <>
            <KpiCards />
            <MapControls />
            <ObjectPanel />
            <TrackingCard />
            <OpsTable />
          </>
        )}
        {view === 'dispatch' && <DispatchBoard />}
        {view === 'data' && <DataView />}
        {view === 'schedule' && (
          <>
            <KpiCards />
            <ObjectPanel />
            <ScheduleView />
          </>
        )}
        <MapPickBanner />
        <EventsDrawer />
        <ConnectionBanner />
      </div>
      <Toasts />
      <CommandPalette />
    </div>
  );
}
