# MiniMax Provider

Open CoDesign includes MiniMax as a built-in provider. The default entry uses the international OpenAI-compatible endpoint and offers `MiniMax-M3.1-Flash` first, followed by `MiniMax-M3`. Existing saved model IDs and custom provider configurations remain unchanged.

## Configuration

- Provider ID: `minimax`
- API key environment variable: `MINIMAX_API_KEY`
- Default model: `MiniMax-M3.1-Flash`
- Model choices: `MiniMax-M3.1-Flash`, `MiniMax-M3`
- Official documentation: https://platform.minimax.io/docs/guides/models-intro.md

The built-in provider uses `https://api.minimax.io/v1`. To use another region or wire format, add a custom provider in Settings:

| Region | Wire | Base URL |
| --- | --- | --- |
| International | OpenAI-compatible | `https://api.minimax.io/v1` |
| International | Anthropic-compatible | `https://api.minimax.io/anthropic` |
| China | OpenAI-compatible | `https://api.minimaxi.com/v1` |
| China | Anthropic-compatible | `https://api.minimaxi.com/anthropic` |

For an Anthropic-compatible entry, enter the base without `/v1`; the adapter derives `/v1/messages`. The default OpenAI-compatible entry uses Chat Completions. MiniMax also documents native Responses at the international `/v1/responses` endpoint; a custom Responses entry retains client-side history instead of using server-side conversation storage. Regional and gateway availability must be checked with the selected service.

## Model catalog

Prices are USD per million tokens. Cache-write pricing is unknown.

| Model | Context | Input | Output | Cache read | Input modalities | Thinking |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `MiniMax-M3.1-Flash` | 1,000,000 | 0.15 | 0.60 | 0.015 | Text, image, video | Adaptive only |
| `MiniMax-M3` | 1,000,000 | 0.60 | 2.40 | 0.12 | Text, image, video | Adaptive, disabled |

Flash supports up to 524,288 output tokens. Its default effort is `max`; low, medium, high, and xhigh are also supported. The application's `minimal` setting maps to low, and `off` retains adaptive thinking because Flash cannot disable it. These settings are normalized for direct MiniMax endpoints in both completion and agent requests. Gateway payloads retain their own contracts.

M3 ignores reasoning effort. Its Chat Completions default is adaptive, while Anthropic-compatible and Responses requests default to thinking disabled. An explicit enabled reasoning level enables adaptive thinking.

M3 pricing depends on input length and service tier. The catalog's headline rate is the longer-input standard rate:

| Service tier | Input length | Input | Output | Cache read |
| --- | --- | ---: | ---: | ---: |
| Standard | Up to 512k | 0.30 | 1.20 | 0.06 |
| Standard | Above 512k | 0.60 | 2.40 | 0.12 |
| Priority | Up to 512k | 0.45 | 1.80 | 0.09 |
| Priority | Above 512k | 0.90 | 3.60 | 0.18 |

Ordinary built-in gateway choices retain only current MiniMax text routes returned by that gateway's catalog. This filtering does not rewrite saved active selections, custom catalogs, or nontext entries.
