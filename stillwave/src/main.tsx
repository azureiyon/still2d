import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);

// Handy for poking at the app from the browser console (and for automated tests).
import { useStore } from './state/store';
import { live } from './ui/live';
(window as unknown as Record<string, unknown>).stillwave = { store: useStore, live };
