# Preserve web search configuration

- Symptom: registered tools report disabled; per-run snapshot comes from getCachedConfig().webSearch, defaults disabled when absent.
- Confirmed code defect: provider CRUD/model switch/external imports/design-system save/image settings save rebuild Config without webSearch. The user's active config has not been inspected; missing/manual disabled/stale cached config are also possible.
- Fix all ordinary settings-save paths to preserve webSearch; keep default opt-in and explicit false. Deleting the last model provider must retain non-provider Tavily credentials. Reset onboarding intentionally clears all secrets but retain feature settings.
- Tests: enabled and disabled flags/budget survive each save, import and reload; missing remains missing; last provider deletion retains Tavily. Test existing IPC routes where possible. Build and typecheck after tests.
- No user credentials/config inspected or changed; network remains opt-in. Advise active config top-level [webSearch] enabled=true and full app restart when field already lost.
- Also discovered legacy permission IPC was not registered/exposed by the live app. Replaced the research-specific authorizer with registered ask IPC and existing AskModal, using the current generation ID, per-run explicit allow/deny and abort cleanup. No new panel or preload protocol.
- Final validation: 176 tests across 9 relevant suites passed, including consent IPC round-trip, deny/abort without network, actual research browser/ZIP integration, and enabled/disabled/missing config preservation through all ordinary save/import paths. Desktop main+renderer typecheck, scoped Biome, git diff --check and production build passed. Live Tavily/API credentials remain untested.
