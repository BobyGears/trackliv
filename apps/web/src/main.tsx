import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Handy for scripted screenshots / debugging in the console.
if (import.meta.env.DEV) {
  void Promise.all([import('./lib/store'), import('./map/MapView')]).then(([s, m]) => {
    (window as unknown as Record<string, unknown>).__trackliv = { useStore: s.useStore, getMap: m.getMap, mapController: m.mapController };
  });
}
