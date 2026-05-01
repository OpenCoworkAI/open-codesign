import {
  assertNonEmptyParsedString,
  callDeepSeekJsonWithRetries,
  ensureBotSignature,
  loadEventPayload,
  loadRepoDocs,
  printUsage,
  readTextFileIfExists,
  requireEnv,
  runGh,
  searchRepoSnippets,
  writeTempJson,
} from './deepseek-common.mjs';

function buildSystemPrompt(basePrompt) {
  return `${basePrompt}

Implementation note:
- You are running through DeepSeek chat completions, not Codex tools.
- Return ONLY valid JSON with the shape {"body":"FULL_MARKDOWN_ISSUE_COMMENT"}.
- Keep the comment ready to post directly to GitHub.
- If you cite code or docs, cite only lines that appear in the supplied repo snippets.`;
}

function serializeDocs(docs) {
  if (docs.length === 0) {
    return 'No repo docs were found in this checkout.';
  }
  return docs.map((doc) => `## ${doc.path}\n${doc.content}`).join('\n\n');
}

async function main() {
  const apiKey = requireEnv('DEEPSEEK_API_KEY');
  const baseUrl = requireEnv('DEEPSEEK_BASE_URL');
  const model = requireEnv('DEEPSEEK_MODEL');
  const effort = process.env.DEEPSEEK_EFFORT || 'high';
  const payload = loadEventPayload();
  const issueNumber = String(payload.issue.number);
  const repo = payload.repository.full_name;

  const prompt = readTextFileIfExists('.github/prompts/issue-auto-response.md');
  if (!prompt) {
    throw new Error('Missing .github/prompts/issue-auto-response.md');
  }

  const issue = JSON.parse(
    runGh([
      'issue',
      'view',
      issueNumber,
      '-R',
      repo,
      '--json',
      'number,title,body,labels,author,url,comments',
    ]),
  );
  const docs = loadRepoDocs(
    ['CLAUDE.md', 'AGENTS.md', 'README.md', 'package.json', 'pnpm-lock.yaml'],
    7000,
  );
  const searchSnippets = searchRepoSnippets(`${issue.title}\n${issue.body || ''}`, 50);

  const userPrompt = [
    `Repo: ${repo}`,
    `Issue number: ${issueNumber}`,
    '',
    'Issue metadata:',
    JSON.stringify(issue, null, 2),
    '',
    'Repository docs:',
    serializeDocs(docs),
    '',
    'Repository search snippets:',
    searchSnippets.length > 0 ? searchSnippets.join('\n') : 'No relevant repo snippets found.',
  ].join('\n');

  const { parsed, usage } = await callDeepSeekJsonWithRetries({
    apiKey,
    baseUrl,
    model,
    effort,
    systemPrompt: buildSystemPrompt(prompt),
    userPrompt,
  });

  const body = ensureBotSignature(assertNonEmptyParsedString(parsed, 'body'));
  const commentPayload = writeTempJson('deepseek-issue-comment', { body });
  runGh([
    'api',
    `repos/${repo}/issues/${issueNumber}/comments`,
    '--method',
    'POST',
    '--input',
    commentPayload,
  ]);
  printUsage('DeepSeek issue response', usage);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
