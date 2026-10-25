# Typed JSON and local context budgets

Protocol v2 removes the ambiguous compact enum notation from the model's instructions. The original `legacy-v1` prompt remains the default so existing experiment configurations remain reproducible; opt in with `responseProtocol: "typed-v2"`. The old prompt hashes are covered by regression tests.

`response-schema.ts` defines an object with five required fields: scalar string enums for `action` and `status`, an array of string `targetIds`, an array of string-valued `{field,value}` changes, and a nullable 64-character hexadecimal `expectedSourceHash`. Extra fields are forbidden. The instructions explain that one change set applies to every target, with no duplicate copy per target; non-edit decisions use empty arrays and a null hash.

The schema specifies shape only. It contains no case IDs, correct actions, valid target IDs, expected field values or case-specific policies. It deliberately does not enforce a correct action/status pairing or source hash. These remain model decisions that can fail the behavior rubric. The dataset, labels and accepted alternative continuations are unchanged.

## Backend enforcement

`responseFormat: "json-schema"` additionally asks an OpenAI chat-compatible backend to enforce the schema. It requires `typed-v2` and `wire: "openai-chat"`; unsupported combinations fail before generation. The existing provider wrapper forwards the schema through pi's payload hook as `response_format.json_schema` with `strict: true`. No new SDK or HTTP inference path was added. Other callers are unchanged unless they opt in.

`responseFormat: "prompt-only"` sends the same typed instructions without backend enforcement. This is used for the current Codex ChatGPT-login wire, for which this change does not add schema transport support. Do not claim that all three models use identical decoding: local models receive grammar constraints, while Codex receives the typed prompt alone. Both are still checked by the same strict parser and behavior scorer.

Backend enforcement is a request, not proof of compliance. Invalid JSON, invalid shape, truncation, refusals and provider errors remain failures. There is no fence stripping, array unwrapping, repair, retry or fallback. Reports now separately expose schema-valid count, format failures, rubric failures and pass rate among schema-valid outputs (null when none exist). The primary pass rate still uses every scheduled case.

Alternate-policy diagnostics now select the accepted policy with the fewest errors, so an otherwise reasonable blocked report is not mislabeled as a wrong action solely because inspection is the primary policy. This changes error explanations, not the pass predicate. The 25 schema-valid outputs from v1 were rescored before v2 execution and retained identical pass/fail results; v1 evidence is untouched.

## Local model budget

The v1 local runtime had a 4096-token context. A larger output limit alone cannot provide room for input plus reasoning/output. V2 uses dedicated model aliases with a 16384-token context and an 8192-token output request, leaving substantial room for the input. The timeout is 240 seconds per case. These are budgets for this short decision benchmark, not a recommendation for full coding/design sessions.

With the source models already installed, the two checked-in Modelfiles reproduce the aliases used in this experiment:

```bash
ollama create qwen3:codesign-eval-4b-16k-v2 \
  -f research/agent-behavior-evals/Qwen3-16k.Modelfile
ollama create gemma4:codesign-eval-12b-16k-v2 \
  -f research/agent-behavior-evals/Gemma4-16k.Modelfile
```

These aliases inherit the installed weights, template, thinking behavior and sampling defaults; only `num_ctx` changes. The original model names and server-wide context setting are not modified. Use fresh alias names if these names are already in use. This work did not download or requantize weights.

After loading each alias, verify the actual context with `ollama ps` or `/api/ps`; configuration text alone is insufficient. The experiment saves runtime evidence before and after each model's runs, including context length and memory allocation. Larger contexts can increase memory pressure or CPU offloading. Neither preload time nor model/hardware differences should be confused with reasoning quality.

The ready-to-use [v2 Ollama configuration](./ollama-v2-config.example.json) selects the Qwen alias; copy it locally to select the Gemma alias or the `constraint-check` variant. Choose a new output directory for each run:

```bash
OLLAMA_LOCAL_TOKEN=local-ollama-placeholder-token corepack pnpm exec tsx \
  research/agent-behavior-evals/model-cli.ts \
  --config research/agent-behavior-evals/ollama-v2-config.example.json \
  --output .Codex/workspace/agent-behavior-evals/ollama-v2-run-001 --execute
```

## Interpretation

The new round changes the typed prompt, local decoding constraints and budgets together. It answers whether the configured pipeline makes better decisions once those problems are reduced; it cannot identify the separate causal contribution of each change. Compare baseline versus constraint-check within v2 to assess their paired observations. A single trial over eight correlated cutoffs from one conversation does not establish significance or general model capability.

References: [Ollama OpenAI compatibility and context configuration](https://docs.ollama.com/api/openai-compatibility), [Ollama context allocation](https://docs.ollama.com/context-length), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
