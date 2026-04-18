# Configuration

open-codesign stores configuration in a TOML file at `~/.config/open-codesign/config.toml`
(or `$XDG_CONFIG_HOME/open-codesign/config.toml` if set). The file is created on first
successful onboarding and is the single source of truth for provider, model, and key
references.

## Layout

```toml
version = 1
provider = "anthropic"
modelPrimary = "claude-sonnet-4-6"
modelFast = "claude-haiku-3"

[secrets.anthropic]
ciphertext = "<base64 ciphertext>"
```

## Keys

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `version` | integer | yes | `1` | Schema version. Must be `1` in v0.1. |
| `provider` | string | yes | — | Active provider id. Tier 1: `anthropic`, `openai`, `openrouter`. |
| `modelPrimary` | string | yes | — | Primary design model id (provider-specific). |
| `modelFast` | string | yes | — | Fast completion model id (provider-specific). |
| `secrets.<provider>.ciphertext` | string | yes for active provider | — | Base64-encoded ciphertext from Electron `safeStorage` (macOS Keychain / Windows Credential Manager / DPAPI on Linux when available). |

## Security model

- API keys are **never written in plaintext**. The renderer pastes a key,
  the main process encrypts it with Electron `safeStorage.encryptString` and
  stores only the base64 ciphertext.
- The keychain is bound to the OS user account. Copying `config.toml` to
  another machine does **not** decrypt the secret — the user must re-onboard.
- File permissions are set to `0600` on POSIX systems.

## Behavior on first run

If the file does not exist, the renderer shows the 3-step onboarding wizard
(Welcome → Paste API key → Choose models). On completion the file is written
and subsequent launches skip the wizard.

If the file exists but is malformed, parsing throws `CONFIG_PARSE_FAILED` /
`CONFIG_SCHEMA_INVALID` and the app surfaces the error in the UI — there is
**no silent fallback** to defaults.

## Adding new providers

Tier 1 hard-codes `anthropic`, `openai`, `openrouter`. Other providers are
parsed by the schema (so a future config file with `provider = "google"` is
not rejected outright) but the onboarding wizard refuses them with
`PROVIDER_NOT_SUPPORTED`. Wider provider support lands in Phase 0.3.

## Resetting

Delete the file:

```bash
rm ~/.config/open-codesign/config.toml
```

The next launch returns to the onboarding wizard.
