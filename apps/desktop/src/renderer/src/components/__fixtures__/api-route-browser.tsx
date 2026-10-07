import { initI18n } from '@open-codesign/i18n';
import type { OnboardingState } from '@open-codesign/shared';
import { createRoot } from 'react-dom/client';
import type { CodesignApi } from '../../../../preload';
import { AddCustomProviderModal } from '../AddCustomProviderModal';
import { ModelsTab } from '../settings/ModelsTab';

type SaveInput = Parameters<CodesignApi['config']['setProviderAndModels']>[0];
const saves: SaveInput[] = [];
let customSaves = 0;
let onSaveCalls = 0;
const state: OnboardingState = {
  hasKey: false,
  provider: null,
  modelPrimary: null,
  baseUrl: null,
  designSystem: null,
};

window.codesign = {
  config: {
    async setProviderAndModels(input: SaveInput) {
      saves.push(input);
      return state;
    },
    async addProvider() {
      customSaves++;
      return state;
    },
    async detectExternalConfigs() {
      return {};
    },
    async testEndpoint() {
      return { ok: false, message: 'Offline fixture', models: [], modelCount: 0 };
    },
  },
  settings: {
    async listProviders() {
      return [];
    },
  },
  onboarding: {
    async getState() {
      return state;
    },
  },
  codexOAuth: {
    async status() {
      return { loggedIn: false, email: null };
    },
  },
} as unknown as CodesignApi;

declare global {
  interface Window {
    apiRouteFixture: {
      snapshot(): { saves: SaveInput[]; customSaves: number; onSaveCalls: number };
    };
  }
}
window.apiRouteFixture = { snapshot: () => ({ saves, customSaves, onSaveCalls }) };

await initI18n('en');
const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root') as HTMLElement).render(
  params.has('menu') ? (
    <ModelsTab />
  ) : (
    <AddCustomProviderModal
      initialValues={{ builtinProvider: 'api-route' }}
      initialSetAsActive={false}
      onSave={() => {
        onSaveCalls++;
      }}
      onClose={() => undefined}
    />
  ),
);
