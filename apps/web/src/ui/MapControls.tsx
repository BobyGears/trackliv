import { Box, Compass, Layers, Minus, Plus, ScanSearch, Warehouse } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { getMap } from '../map/MapView';
import { IconButton, Panel, Toggle } from './kit';
import { t } from '../lib/i18n';

export function MapControls() {
  const is3d = useStore((s) => s.is3d);
  const layers = useStore((s) => s.layers);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  const st = useStore.getState;
  return (
    <div ref={ref} className="pointer-events-auto absolute left-3 top-[200px] z-20 flex flex-col gap-2">
      <Panel className="flex flex-col p-1">
        <IconButton label={t('Zoom in')} onClick={() => getMap()?.zoomIn()}>
          <Plus size={16} />
        </IconButton>
        <IconButton label={t('Zoom out')} onClick={() => getMap()?.zoomOut()}>
          <Minus size={16} />
        </IconButton>
      </Panel>
      <Panel className="flex flex-col p-1">
        <IconButton label={t('Fit all projects')} onClick={() => st().requestFocus({ kind: 'fit-all' })}>
          <ScanSearch size={16} />
        </IconButton>
        <IconButton
          label={t('HQs in 3D')}
          onClick={() => {
            const site = st().sites[0];
            if (site) st().select({ type: 'site', id: site.id }, { focus: true });
          }}
        >
          <Warehouse size={16} />
        </IconButton>
        <IconButton label={is3d ? t('Flat view') : t('Tilted 3D view')} active={is3d} onClick={() => st().set3d(!is3d)}>
          <Box size={16} />
        </IconButton>
        <IconButton label={t('Reset north')} onClick={() => getMap()?.easeTo({ bearing: 0, duration: 600 })}>
          <Compass size={16} />
        </IconButton>
        <IconButton label={t('Layers')} active={open} onClick={() => setOpen(!open)}>
          <Layers size={16} />
        </IconButton>
      </Panel>
      {open && (
        <Panel className="fade-in absolute left-12 top-[88px] w-64 p-3 shadow-float">
          <div className="mb-1 text-[12px] font-semibold">{t('Map layers')}</div>
          <Toggle on={layers.routes} onChange={() => st().toggleLayer('routes')} label={t('Planned routes')} hint={t('Depot → destination on the road network')} />
          <Toggle on={layers.buildings} onChange={() => st().toggleLayer('buildings')} label={t('3D buildings')} hint={t('True-scale HQs and surroundings')} />
          <Toggle on={layers.crew} onChange={() => st().toggleLayer('crew')} label={t('Crew figures')} hint={t('People next to their vehicle')} />
          <Toggle on={layers.labels} onChange={() => st().toggleLayer('labels')} label={t('Place & street labels')} />
          <Toggle on={layers.streets} onChange={() => st().toggleLayer('streets')} label={t('Street map of Germany (online)')} hint={t('OpenFreeMap · off: offline Rhein-Main map')} />
        </Panel>
      )}
    </div>
  );
}
