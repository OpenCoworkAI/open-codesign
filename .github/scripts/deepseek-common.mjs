import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STOP_WORDS = new Set([
  'about',
  'after',
  'already',
  'also',
  'because',
  'before',
  'comment',
  'design',
  'error',
  'feature',
  'from',
  'github',
  'have',
  'into',
  'issue',
  'just',
  'need',
  'open',
  'please',
  'pull',
  'request',
  'review',
  'should',
  'that',
  'them',
  'there',
  'this',
  'when',
  'with',
]);

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadEventPayload() {
  return JSON.parse(fs.readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8'));
}

export function readTextFileIfExists(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

export function truncate(text, maxChars, label = 'content') {
  if (!text) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[truncated ${label}; original length ${text.length}]`;
}

function formatCommandError(command, args, error) {
  const stderr = error.stderr?.toString?.() || '';
  const stdout = error.stdout?.toString?.() || '';
  const details = stderr || stdout || error.message;
  return `${command} ${args.join(' ')} failed: ${details}`.trim();
}

export function runGh(args, options = {}) {
  try {
    return execFileSync('gh', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      input: options.input,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(formatCommandError('gh', args, error));
  }
}

export function runGit(args, fallback = '') {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (fallback !== '') return fallback;
    throw new Error(formatCommandError('git', args, error));
  }
}

function runGitGrepFromRgArgs(args) {
  let fixedStrings = false;
  let lineNumbers = false;
  let maxCount = null;
  const patterns = [];
  const pathspecs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-F') {
      fixedStrings = true;
      continue;
    }
    if (arg === '-n') {
      lineNumbers = true;
      continue;
    }
    if (arg === '--max-count') {
      maxCount = args[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === '-e') {
      const pattern = args[index + 1];
      if (pattern) {
        patterns.push(pattern);
      }
      index += 1;
      continue;
    }
    if (arg === '--glob') {
      const glob = args[index + 1];
      if (glob?.startsWith('!')) {
        pathspecs.push(`:!${glob.slice(1)}`);
      } else if (glob) {
        pathspecs.push(glob);
      }
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) {
      pathspecs.push(arg);
    }
  }

  if (patterns.length === 0) {
    return '';
  }

  const gitArgs = ['grep'];
  if (lineNumbers) {
    gitArgs.push('-n');
  }
  if (fixedStrings) {
    gitArgs.push('-F');
  }
  if (maxCount) {
    gitArgs.push(`--max-count=${maxCount}`);
  }
  for (const pattern of patterns) {
    gitArgs.push('-e', pattern);
  }
  gitArgs.push('--', ...(pathspecs.length > 0 ? pathspecs : ['.']));

  try {
    return execFileSync('git', gitArgs, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (error.status === 1) {
      return '';
    }
    throw new Error(formatCommandError('git', gitArgs, error));
  }
}

export function runRg(args) {
  try {
    return execFileSync('rg', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (error.status === 1) {
      return '';
    }
    if (error.code === 'ENOENT') {
      return runGitGrepFromRgArgs(args);
    }
    throw new Error(formatCommandError('rg', args, error));
  }
}

export function normalizeApiBaseUrl(baseUrl) {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/responses$/, '')
    .replace(/\/responses$/, '')
    .replace(/\/v1\/chat\/completions$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/v1$/, '');
}

export function buildDeepSeekChatUrl(baseUrl) {
  return `${normalizeApiBaseUrl(baseUrl)}/chat/completions`;
}

export function mapReasoningEffort(effort = 'high') {
  switch (effort.trim().toLowerCase()) {
    case 'none':
      return 'none';
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
    case 'high':
    case 'xhigh':
      return 'high';
    case 'max':
    case 'ultra':
      return 'max';
    default:
      throw new RangeError('Unsupported DeepSeek reasoning effort.');
  }
}

export function resolveThinkingConfig(_model, effort = 'high') {
  // Flash also defaults to thinking; model-name inference cannot express an explicit opt-out.
  return { type: mapReasoningEffort(effort) === 'none' ? 'disabled' : 'enabled' };
}

export function parseJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export class DeepSeekOutputError extends Error {
  constructor(code, message, diagnostics = {}) {
    super(`[${code}] ${message} ${JSON.stringify(diagnostics)}`);
    this.name = 'DeepSeekOutputError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

function safeModelName(value, apiKey) {
  if (typeof value !== 'string' || !/^[\w./:-]{1,128}$/.test(value)) return null;
  if (apiKey && value.includes(apiKey)) return null;
  return value;
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const result = {};
  for (const field of [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
  ]) {
    if (Number.isSafeInteger(usage[field]) && usage[field] >= 0) result[field] = usage[field];
  }
  for (const [field, count] of [
    ['completion_tokens_details', 'reasoning_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
  ]) {
    const value = usage[field]?.[count];
    if (Number.isSafeInteger(value) && value >= 0) result[field] = { [count]: value };
  }
  return Object.keys(result).length > 0 ? result : null;
}

function outputDiagnostics(payload, model, apiKey, maxTokens) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning_content;
  const reason = choice?.finish_reason;
  return {
    requestedModel: safeModelName(model, apiKey),
    returnedModel: safeModelName(payload?.model, apiKey),
    finishReason: [
      'stop',
      'length',
      'content_filter',
      'tool_calls',
      'function_call',
      'aborted',
      'insufficient_system_resource',
    ].includes(reason)
      ? reason
      : 'unknown',
    maxTokens,
    contentChars: typeof content === 'string' ? content.length : 0,
    reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
    usage: sanitizeUsage(payload?.usage),
  };
}

function validateLimit(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
  }
}

export async function callDeepSeekJson({
  apiKey,
  baseUrl,
  model,
  effort,
  systemPrompt,
  userPrompt,
  maxTokens = 8192,
}) {
  validateLimit(maxTokens, 'maxTokens', 65_536);
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    reasoning_effort: mapReasoningEffort(effort),
    thinking: resolveThinkingConfig(model, effort),
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    stream: false,
  };
  const requestDiagnostics = { requestedModel: safeModelName(model, apiKey), maxTokens };
  let response;
  let rawText;
  let phase = 'request';
  try {
    response = await fetch(buildDeepSeekChatUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok) {
      // Provider error bodies may echo input or credentials; only log the HTTP status.
      void response.body?.cancel().catch(() => {});
      throw new DeepSeekOutputError('HTTP_ERROR', 'DeepSeek API request failed.', {
        ...requestDiagnostics,
        status: response.status,
      });
    }
    phase = 'response_body';
    rawText = await response.text();
  } catch (error) {
    if (error instanceof DeepSeekOutputError) throw error;
    throw new DeepSeekOutputError('REQUEST_FAILED', 'DeepSeek request did not complete.', {
      ...requestDiagnostics,
      phase,
      reason:
        error?.name === 'TimeoutError'
          ? 'timeout'
          : error?.name === 'AbortError'
            ? 'aborted'
            : 'network',
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    // JSON.parse errors can include raw input; replace rather than forwarding them.
    throw new DeepSeekOutputError(
      'INVALID_RESPONSE',
      'DeepSeek returned an invalid JSON envelope.',
      requestDiagnostics,
    );
  }
  const diagnostics = outputDiagnostics(payload, model, apiKey, maxTokens);
  const choice = payload?.choices?.[0];
  if (!Array.isArray(payload?.choices) || !choice || typeof choice !== 'object') {
    throw new DeepSeekOutputError(
      'INVALID_RESPONSE',
      'DeepSeek returned no valid completion choice.',
      diagnostics,
    );
  }
  if (choice.finish_reason === 'length') {
    throw new DeepSeekOutputError(
      'OUTPUT_TRUNCATED',
      'DeepSeek exhausted the output budget before completion.',
      diagnostics,
    );
  }
  if (choice.finish_reason !== 'stop') {
    throw new DeepSeekOutputError(
      'INCOMPLETE_OUTPUT',
      'DeepSeek did not finish normally; no automated output is available.',
      diagnostics,
    );
  }
  const content = choice.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new DeepSeekOutputError(
      'EMPTY_CONTENT',
      'DeepSeek returned no final message content.',
      diagnostics,
    );
  }
  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DeepSeekOutputError(
      'INVALID_JSON',
      'DeepSeek final content is not a JSON object.',
      diagnostics,
    );
  }
  return { parsed, usage: diagnostics.usage, content, diagnostics };
}

function isRetryableDeepSeekOutputError(error) {
  return (
    error instanceof DeepSeekOutputError &&
    ['OUTPUT_TRUNCATED', 'EMPTY_CONTENT', 'INVALID_JSON', 'EMPTY_BODY'].includes(error.code)
  );
}

export function assertNonEmptyParsedString(parsed, fieldName = 'body', diagnostics = {}) {
  const value =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed[fieldName] : undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new DeepSeekOutputError(
    'EMPTY_BODY',
    'Model returned an empty required text field.',
    diagnostics,
  );
}

export async function callDeepSeekJsonWithRetries(options) {
  const {
    maxAttempts = 3,
    fieldName = 'body',
    userPrompt,
    maxTokens = 8192,
    maxRetryTokens = Math.max(maxTokens, 32_768),
    ...requestOptions
  } = options;
  validateLimit(maxAttempts, 'maxAttempts', 3);
  validateLimit(maxTokens, 'maxTokens', 65_536);
  validateLimit(maxRetryTokens, 'maxRetryTokens', 65_536);
  if (maxRetryTokens < maxTokens)
    throw new RangeError('maxRetryTokens must not be below maxTokens.');
  let budget = maxTokens;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptPrompt =
      attempt === 1
        ? userPrompt
        : [
            userPrompt,
            '',
            'AUTOMATION RETRY NOTE:',
            '- Your previous response was incomplete or invalid for automation.',
            '- Finish with ONLY valid JSON; keep the final response concise.',
            `- The JSON MUST include a non-empty string field named "${fieldName}".`,
            '- Do not wrap the JSON in code fences. Do not substitute reasoning for the final answer.',
          ].join('\n');
    try {
      const result = await callDeepSeekJson({
        ...requestOptions,
        maxTokens: budget,
        userPrompt: attemptPrompt,
      });
      assertNonEmptyParsedString(result.parsed, fieldName, result.diagnostics);
      return result;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableDeepSeekOutputError(error)) throw error;
      // Reasoning-only output is a budget hypothesis, not proof. Never lower review quality to force a pass.
      const needsBudget =
        error.code === 'OUTPUT_TRUNCATED' ||
        (error.code === 'EMPTY_CONTENT' && error.diagnostics.reasoningChars > 0);
      let nextBudget = budget;
      if (needsBudget) {
        nextBudget = Math.min(budget * 2, maxRetryTokens);
        if (nextBudget === budget) {
          throw new DeepSeekOutputError(
            error.code,
            'Output remains incomplete at the configured token ceiling; automated output unavailable.',
            error.diagnostics,
          );
        }
      }
      console.warn(
        `DeepSeek output invalid on attempt ${attempt}/${maxAttempts}: ${error.message}; retry max_tokens=${nextBudget}`,
      );
      budget = nextBudget;
    }
  }
  throw new Error('DeepSeek output validation failed after bounded retries.');
}

export function ensureBotSignature(body) {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Model returned an empty body.');
  }
  if (trimmed.includes('*Open-CoDesign Bot*')) {
    return trimmed;
  }
  return `${trimmed}\n\n*Open-CoDesign Bot*`;
}

export function writeTempJson(prefix, value) {
  const tempPath = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  return tempPath;
}

export function printUsage(label, usage) {
  const safeUsage = sanitizeUsage(usage);
  if (!safeUsage) return;
  console.log(`${label} usage`);
  console.log(JSON.stringify(safeUsage, null, 2));
}

export function loadRepoDocs(relativePaths, maxChars = 6000) {
  return relativePaths
    .map((relativePath) => {
      const content = readTextFileIfExists(relativePath);
      if (!content) {
        return null;
      }
      return {
        path: relativePath,
        content: truncate(content, maxChars, relativePath),
      };
    })
    .filter(Boolean);
}

export function listPullRequestFiles(repo, prNumber) {
  return JSON.parse(runGh(['api', `repos/${repo}/pulls/${prNumber}/files?per_page=100`]));
}

export function loadPullRequestFileExcerpts(prNumber, filePaths, maxFiles = 8, maxChars = 5000) {
  const excerpts = [];
  for (const filePath of [...new Set(filePaths)].slice(0, maxFiles)) {
    try {
      const content = execFileSync(
        'git',
        ['show', `refs/remotes/pull/${prNumber}/head:${filePath}`],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 5 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      excerpts.push({
        path: filePath,
        content: truncate(content, maxChars, filePath),
      });
    } catch {
      // Skip files that are deleted, binary, or otherwise unavailable.
    }
  }
  return excerpts;
}

export function extractKeywords(text) {
  const keywords = [];
  const seen = new Set();

  const pushKeyword = (value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized) || STOP_WORDS.has(normalized)) {
      return;
    }
    seen.add(normalized);
    keywords.push(value.trim());
  };

  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_.:-]{3,}/g)) {
    pushKeyword(match[0]);
  }
  for (const match of text.matchAll(/\p{Script=Han}{2,}/gu)) {
    pushKeyword(match[0]);
  }
  return keywords.slice(0, 12);
}

export function searchRepoSnippets(seedText, maxLines = 40) {
  const keywords = extractKeywords(seedText);
  if (keywords.length === 0) {
    return [];
  }
  const args = ['-n', '-F', '--max-count', '2'];
  for (const keyword of keywords) {
    args.push('-e', keyword);
  }
  args.push('--glob', '!node_modules/**', '--glob', '!dist/**', '--glob', '!website/**', '.');

  return runRg(args)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}
