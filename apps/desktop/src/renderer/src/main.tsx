import { initI18n, normalizeLocale } from '@open-codesign/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { useCodesignStore } from './store';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

async function bootstrap(): Promise<void> {
  const persisted = await window.codesign?.locale.getCurrent();
  const initial = normalizeLocale(persisted ?? navigator.language);
  await initI18n(initial);
  useCodesignStore.setState({ locale: initial });

  // Persist any normalization back to disk so subsequent boots are stable.
  if (window.codesign && persisted !== initial) {
    await window.codesign.locale.set(initial);
  }

  createRoot(container as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
