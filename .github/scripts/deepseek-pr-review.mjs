import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const marker = '*open-codesign Bot*';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function runGit(args, fallback = '') {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return fallback;
  }
}

async function github(path, init = {}) {
  const token = requiredEnv('GITHUB_TOKEN');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
  return response.status === 204 ? null : response.json();
}

async function deepseekReview(prompt) {
  const apiKey = requiredEnv('DEEPSEEK_API_KEY');
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are reviewing an Open CoDesign pull request. Prioritize correctness, regressions, missing tests, and security. Be concise.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek API ${response.status}: ${body}`);
  }
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content?.trim() || 'No review comments returned.';
}

function buildPrompt(event) {
  const baseRef = event.pull_request.base.ref;
  const baseSha = event.pull_request.base.sha;
  const headSha = event.pull_request.head.sha;
  const promptTemplate = readFileSync('.github/prompts/codex-pr-review.md', 'utf8');
  const stat = runGit(['diff', '--stat', `${baseSha}...${headSha}`]);
  const diff = runGit(['diff', '--find-renames', '--unified=80', `${baseSha}...${headSha}`]);
  const clippedDiff =
    diff.length > 180_000
      ? `${diff.slice(0, 180_000)}\n\n[diff clipped at 180000 characters]\n`
      : diff;
  return `${promptTemplate}

Repository: ${process.env.GITHUB_REPOSITORY}
Pull request: #${event.pull_request.number}
Base branch: ${baseRef}
Head SHA: ${headSha}

Diff stat:
${stat}

Diff:
${clippedDiff}`;
}

async function main() {
  const event = JSON.parse(readFileSync(requiredEnv('GITHUB_EVENT_PATH'), 'utf8'));
  const [owner, repo] = requiredEnv('GITHUB_REPOSITORY').split('/');
  const pullNumber = event.pull_request.number;
  const prompt = buildPrompt(event);
  const review = await deepseekReview(prompt);
  const body = `${marker}

${review}`;

  await github(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
    method: 'POST',
    body: JSON.stringify({
      commit_id: process.env.CURRENT_HEAD_SHA || event.pull_request.head.sha,
      event: 'COMMENT',
      body,
    }),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
