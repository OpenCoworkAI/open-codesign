# Credential boot failure fix

- Diagnosis: decryptSecret treats unprefixed values as legacy safeStorage ciphertext. migrateSecrets currently fails the entire boot when any secret is invalid, including optional Tavily entries. No user credentials inspected.
- Change: isolate migration failures per entry, retain original data, redact logs, keep strict decrypt-on-use; correct stale boot migration comment. Add exact-config recovery guidance.
- Tests: raw Tavily key, corrupted safe/legacy value, empty plaintext, unavailable keychain, mixed good/bad entries, boot cache and persistence behavior. Never treat failed ciphertext as plaintext.
- Validation complete: 145 tests across keychain, actual boot config-cache migration, onboarding IPC, auth bridge, provider settings, credential resolution and image settings passed. Desktop main/renderer typechecks, scoped Biome, git diff --check and desktop production build passed.
- No user credentials/config were read or changed; no real-config app launch was attempted. Build output was refreshed at apps/desktop/out. The user must correct any unreadable credential before using that service; the log alone cannot identify which stored entry caused the original failure.
