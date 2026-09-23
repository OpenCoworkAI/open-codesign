# MiniMax Provider

Open CoDesign includes MiniMax as a built-in provider. The default entry uses the global English OpenAI-compatible endpoint and exposes `MiniMax-M3` and `MiniMax-M2.7` as static model choices.

## Configuration

- Provider ID: `minimax`
- API key environment variable: `MINIMAX_API_KEY`
- Default model: `MiniMax-M3`
- Model choices: `MiniMax-M3`, `MiniMax-M2.7`
- Official documentation: `https://platform.minimax.io/docs/api-reference/api-overview`
- China documentation: `https://platform.minimaxi.com/docs/api-reference/api-overview`

The built-in provider uses `https://api.minimax.io/v1`. To use another region or wire format, add a custom provider in Settings and use one of these public bases:

| Region | Wire | Base URL | Documentation |
| --- | --- | --- | --- |
| `global_en` | OpenAI-compatible | `https://api.minimax.io/v1` | `https://platform.minimax.io/docs` |
| `global_en` | Anthropic-compatible | `https://api.minimax.io/anthropic` | `https://platform.minimax.io/docs` |
| `cn_zh` | OpenAI-compatible | `https://api.minimaxi.com/v1` | `https://platform.minimaxi.com/docs` |
| `cn_zh` | Anthropic-compatible | `https://api.minimaxi.com/anthropic` | `https://platform.minimaxi.com/docs` |

For an Anthropic-compatible entry, enter the base directly without adding `/v1`. Open CoDesign derives the versioned `/v1/messages` request path internally. For an OpenAI-compatible entry, keep `/v1` in the public base; the client appends the chat-completions path.

## Model catalog

Prices are USD per million tokens. The model metadata below mirrors the shared provider registry.

| Model | Context | Input | Output | Cache read | Cache write | Input modalities | Thinking |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `MiniMax-M3` | 1,000,000 | 0.60 | 2.40 | 0.12 | null | Text, image, video | Adaptive, disabled |
| `MiniMax-M2.7` | 204,800 | 0.30 | 1.20 | 0.06 | 0.375 | Text | Always on |

`MiniMax-M3` has tiered pricing based on input length and service tier:

| Service tier | Input length | Input | Output | Cache read |
| --- | --- | ---: | ---: | ---: |
| Standard | Up to 512,000 | 0.30 | 1.20 | 0.06 |
| Standard | Above 512,000 | 0.60 | 2.40 | 0.12 |
| Priority | Up to 512,000 | 0.45 | 1.80 | 0.09 |
| Priority | Above 512,000 | 0.90 | 3.60 | 0.18 |

The desktop provider adapter keeps MiniMax OpenAI-compatible models on the chat-completions path and does not enable the OpenAI developer-role reasoning flag for these model IDs.
