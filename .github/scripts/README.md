# GitHub automation scripts

These scripts are CI-only tooling, not desktop/runtime dependencies. The DeepSeek
PR reviewer and issue responder share `deepseek-common.mjs`.

## Local tests

```sh
pnpm test:scripts
```

The dependency-free Node test suite replaces `fetch` with synthetic responses.
It does not use provider credentials, call a model, or post GitHub reviews/comments.
It also runs at the beginning of `pnpm test`, including the existing CI test step.
The bot workflows currently use Node 20; tests avoid Node 22-only mocking APIs.

## DeepSeek output policy

- Keep the configured model and endpoint unchanged, including provider-supported aliases.
- Set thinking explicitly from the configured effort: `none` disables it;
  `low`, `high`, and `max` enable it. Map `minimal` to `low`, `medium`/`xhigh`
  to `high`, and `ultra` to `max`. Reject unsupported settings rather than
  silently treating every setting as `high`.
- Require `finish_reason: stop`, a JSON object, and a non-empty string `body`.
  Reject `length` even if the partial content happens to parse. Other abnormal
  or missing finish reasons fail closed. Never substitute reasoning for a review.
- Start a PR review at 16,384 output tokens, with a 32,768-token retry ceiling.
  The shared default remains 8,192 for the smaller issue-response caller.
- Make at most three attempts (at most two retries). Double the budget only for `length` or an empty
  final answer with non-empty reasoning. The latter is a recovery heuristic,
  not proof of budget exhaustion. Stop immediately if that budget cannot grow.
  Ordinary empty/malformed output gets a concise JSON reminder at the same budget.
- Do not silently lower effort, disable thinking, switch models, or post a fake
  approval to make a check green. HTTP, network, malformed-envelope, and abnormal
  termination failures do not trigger blind model retries.
- The shared helper accepts explicit budgets up to 65,536 tokens and refuses a
  retry ceiling below the initial budget. Production callers use the smaller
  limits above. Token ceilings are maximums, not fixed billed usage.

## Failure diagnostics

Errors carry a stable code and safe structured metadata: configured/returned
model identifiers, finish reason, budget, final-content/reasoning character
counts, and whitelisted numeric token usage. HTTP errors report the status only;
transport errors report the request/response-body phase and a coarse reason.
Raw prompts, responses, reasoning, parsed invalid bodies, and provider error
bodies are not logged. This retains the tail metadata that the old 1,000-character
response prefix lost, without publishing model reasoning in Actions logs.

## Deployment and verification

The PR review workflow checks out the **trusted base SHA**, not the PR head.
A repair PR's own automated review therefore still uses the old implementation.
Re-running an old Actions run is also not a reliable test of newly merged code:
its original event/base SHA can still select the old script. After merging the
repair, use a newly triggered review with that repair in its trusted base to
validate real provider behavior. A successful HTTP request alone is not a passing
review: verify the final output and the actual GitHub review submission.

No Secrets or repository variables are changed by this repair. Both PR reviews
and issue replies use the existing `REVIEW_*` configuration fallbacks, so test
both callers before changing shared policy. Context deduplication, full file-list
pagination, and batching of large diffs are separate follow-ups; this repair does
not claim full context coverage for large PRs.

Protocol references:
- [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Chat completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [JSON mode and occasional empty responses](https://api-docs.deepseek.com/guides/json_mode/)
- [Flash alias migration](https://api-docs.deepseek.com/news/news260910/)
