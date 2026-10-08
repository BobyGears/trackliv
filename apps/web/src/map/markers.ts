// DOM builders for MapLibre HTML markers (kept framework-free for speed).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const ICON_WAREHOUSE =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/></svg>';

export function siteMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'tl-marker tl-site';
  return el;
}

export function renderSiteMarker(
  el: HTMLElement,
  s: { code: string; name: string; color: string; vehiclesHome: number; vehiclesTotal: number; idle: number; selected: boolean },
) {
  el.classList.toggle('is-selected', s.selected);
  el.innerHTML = `
    <div class="badge" style="background:${s.color}">${ICON_WAREHOUSE}</div>
    <div style="line-height:1.2">
      <div style="font-weight:700;font-size:11.5px">${esc(s.name)} <span class="mono" style="color:var(--muted);font-weight:600;font-size:10px">${esc(s.code)}</span></div>
      <div style="color:var(--muted);font-size:10.5px">${s.vehiclesHome}/${s.vehiclesTotal} vehicles in yard · ${s.idle} crew unassigned</div>
    </div>`;
}

export function projectMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'tl-marker';
  el.innerHTML = '<div class="tl-project"></div>';
  return el;
}

export function renderProjectMarker(
  el: HTMLElement,
  p: { name: string; code: string; color: string; vehicles: number; crew: number; onSite: number; enRoute: number; selected: boolean; dim: boolean; compact: boolean; status: string },
) {
  const chip = el.firstElementChild as HTMLElement;
  chip.classList.toggle('is-selected', p.selected);
  chip.classList.toggle('is-dim', p.dim);
  const meta =
    p.vehicles === 0
      ? p.status === 'active'
        ? 'no crew today'
        : p.status
      : `${p.crew} crew · ${p.onSite ? `${p.onSite} on site` : `${p.enRoute} en route`}`;
  chip.innerHTML = `
    <span class="dot" style="background:${p.color}">${p.crew || ''}</span>
    ${p.compact ? '' : `<span>${esc(p.name)}</span><span class="meta">${esc(meta)}</span>`}`;
  chip.style.padding = p.compact ? '3px' : '';
}

export function vehicleMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'tl-marker';
  el.innerHTML = '<div class="tl-vehicle"><span class="arrow"></span><span class="txt"></span></div>';
  return el;
}

const ARROW =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 20 21 12 17 4 21z"/></svg>';
const PARK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="6"/></svg>';

export function renderVehicleMarker(
  el: HTMLElement,
  v: { callsign: string; color: string; heading: number; moving: boolean; selected: boolean; label: boolean; lifted?: boolean; status: string },
) {
  const chip = el.firstElementChild as HTMLElement;
  chip.classList.toggle('is-selected', v.selected);
  chip.classList.toggle('is-label', v.label || v.lifted);
  const arrow = chip.querySelector('.arrow') as HTMLElement;
  arrow.style.background = v.color;
  const html = v.moving ? ARROW : PARK;
  if (arrow.dataset.kind !== (v.moving ? 'a' : 'p')) {
    arrow.innerHTML = html;
    arrow.dataset.kind = v.moving ? 'a' : 'p';
  }
  (arrow.firstElementChild as HTMLElement | null)?.style.setProperty('transform', v.moving ? `rotate(${v.heading}deg)` : '');
  const txt = chip.querySelector('.txt') as HTMLElement;
  const text = v.label ? `${v.callsign} <span style="font-family:var(--font-sans);font-weight:600;color:var(--muted)">${esc(v.status)}</span>` : v.callsign;
  if (txt.innerHTML !== text) txt.innerHTML = text;
}
