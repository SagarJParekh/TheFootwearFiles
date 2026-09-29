import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Debug/e2e handle (dev builds only).
if (import.meta.env.DEV) {
  void Promise.all([import('./state/store'), import('./viewer/sceneRefs')]).then(([store, refs]) => {
    (window as unknown as Record<string, unknown>).__app = { useStore: store.useStore, sceneRefs: refs.sceneRefs };
  });
}
