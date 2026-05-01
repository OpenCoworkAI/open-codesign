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

export function mapReasoningEffort(effort) {
  const normalized = (effort || 'high').toLowerCase();
  if (normalized === 'xhigh' || normalized === 'max') {
    return 'max';
  }
  return 'high';
}

export function resolveThinkingConfig(model) {
  const normalized = (model || '').toLowerCase();
  if (normalized === 'deepseek-reasoner' || normalized.startsWith('deepseek-v4-pro')) {
    return { type: 'enabled' };
  }
  return null;
}

export function parseJsonObject(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
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
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    reasoning_effort: mapReasoningEffort(effort),
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    stream: false,
  };

  const thinking = resolveThinkingConfig(model);
  if (thinking) {
    requestBody.thinking = thinking;
  }

  const response = await fetch(buildDeepSeekChatUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(
      `DeepSeek API error ${response.status}: ${truncate(rawText, 1000, 'error body')}`,
    );
  }

  const payload = JSON.parse(rawText);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(
      `DeepSeek API returned no message content: ${truncate(rawText, 1000, 'response')}`,
    );
  }

  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `DeepSeek returned non-JSON content: ${truncate(content, 1000, 'model output')}`,
    );
  }

  return {
    parsed,
    usage: payload.usage || null,
    content,
  };
}

function isRetryableDeepSeekOutputError(error) {
  const message = String(error?.message || error)
  return (
    message.includes('DeepSeek API returned no message content') ||
    message.includes('DeepSeek returned non-JSON content') ||
    message.includes('Model returned an empty body.')
  )
}

export function assertNonEmptyParsedString(parsed, fieldName = 'body') {
  const value = parsed && typeof parsed === 'object' ? parsed[fieldName] : undefined
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  let serialized = ''
  try {
    serialized = JSON.stringify(parsed)
  } catch {
    serialized = String(parsed)
  }
  throw new Error(
    `Model returned an empty ${fieldName}. Parsed payload: ${truncate(serialized, 1000, 'parsed payload')}`
  )
}

export async function callDeepSeekJsonWithRetries(options) {
  const { maxAttempts = 3, fieldName = 'body', userPrompt, ...requestOptions } = options
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptPrompt =
      attempt === 1
        ? userPrompt
        : [
            userPrompt,
            '',
            'AUTOMATION RETRY NOTE:',
            '- Your previous response was invalid for automation.',
            '- Return ONLY valid JSON.',
            `- The JSON MUST include a non-empty string field named "${fieldName}".`,
            '- Do not wrap the JSON in code fences.',
            `- Do not return an empty, null, or missing "${fieldName}" field.`,
          ].join('\n')

    try {
      const result = await callDeepSeekJson({
        ...requestOptions,
        userPrompt: attemptPrompt,
      })
      assertNonEmptyParsedString(result.parsed, fieldName)
      return result
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetryableDeepSeekOutputError(error)) {
        throw error
      }
      console.warn(
        `DeepSeek output invalid on attempt ${attempt}/${maxAttempts}: ${error.message}`
      )
    }
  }

  throw lastError || new Error('DeepSeek output validation failed after retries.')
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
  if (!usage) {
    return;
  }
  console.log(`${label} usage`);
  console.log(JSON.stringify(usage, null, 2));
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
