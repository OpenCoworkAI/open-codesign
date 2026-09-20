import { initI18n } from '@open-codesign/i18n';
import '@open-codesign/ui/fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserShim } from './browser-shim';
import './index.css';
import { installRendererLogBridge } from './lib/renderer-logger';

// In browser-only mode (no Electron), provide an in-memory IPC shim
// so the full UI renders and design CRUD works.
installBrowserShim();

// Install as early as possible so errors during bootstrap are captured.
installRendererLogBridge();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');
const root = createRoot(container);

async function bootstrap(): Promise<void> {
  const locale = window.codesign ? await window.codesign.locale.getCurrent() : undefined;
  await initI18n(locale);

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
