import {
  assertNonEmptyParsedString,
  callDeepSeekJsonWithRetries,
  ensureBotSignature,
  listPullRequestFiles,
  loadEventPayload,
  loadPullRequestFileExcerpts,
  loadRepoDocs,
  printUsage,
  readTextFileIfExists,
  requireEnv,
  runGh,
  truncate,
  writeTempJson,
} from './deepseek-common.mjs';

function buildSystemPrompt(basePrompt) {
  return `${basePrompt}

Implementation note:
- You are running through DeepSeek chat completions, not Codex tools.
- Return ONLY valid JSON with the shape {"body":"FULL_MARKDOWN_REVIEW_BODY"}.
- Put every finding directly in the review body itself.
- Do not assume inline review comments are available.
- Keep the markdown body ready to post as a summary-only GitHub PR review.`;
}

function serializeDocs(docs) {
  if (docs.length === 0) {
    return 'No repo docs were found in this checkout.';
  }
  return docs.map((doc) => `## ${doc.path}\n${doc.content}`).join('\n\n');
}

function serializeFiles(files) {
  if (files.length === 0) {
    return 'No changed files metadata available.';
  }
  return files
    .map((file) =>
      [
        `### ${file.filename}`,
        `status: ${file.status}`,
        `additions: ${file.additions}`,
        `deletions: ${file.deletions}`,
        file.patch ? truncate(file.patch, 6000, `${file.filename} patch`) : '[no patch available]',
      ].join('\n'),
    )
    .join('\n\n');
}

function serializeExcerpts(excerpts) {
  if (excerpts.length === 0) {
    return 'No PR-head file excerpts available.';
  }
  return excerpts.map((entry) => `## ${entry.path}\n${entry.content}`).join('\n\n');
}

async function main() {
  const apiKey = requireEnv('DEEPSEEK_API_KEY');
  const baseUrl = requireEnv('DEEPSEEK_BASE_URL');
  const model = requireEnv('DEEPSEEK_MODEL');
  const effort = process.env.DEEPSEEK_EFFORT || 'high';
  const payload = loadEventPayload();
  const prNumber = String(payload.pull_request.number);
  const repo = payload.repository.full_name;
  const currentHeadSha = process.env.CURRENT_HEAD_SHA || payload.pull_request.head.sha;
  const latestBotReviewId = process.env.LATEST_BOT_REVIEW_ID || '';
  const latestBotReviewCommit = process.env.LATEST_BOT_REVIEW_COMMIT || '';
  const isFollowUpReview = process.env.IS_FOLLOW_UP_REVIEW === 'true';

  const prompt = readTextFileIfExists('.github/prompts/codex-pr-review.md');
  if (!prompt) {
    throw new Error('Missing .github/prompts/codex-pr-review.md');
  }

  const prMeta = JSON.parse(
    runGh([
      'pr',
      'view',
      prNumber,
      '-R',
      repo,
      '--json',
      'number,title,body,labels,author,additions,deletions,changedFiles,headRefOid,baseRefName,headRefName,url',
    ]),
  );
  const diff = runGh(['pr', 'diff', prNumber, '-R', repo]);
  const files = listPullRequestFiles(repo, prNumber);
  const docs = loadRepoDocs(
    [
      'CLAUDE.md',
      'AGENTS.md',
      'README.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'package.json',
      'pnpm-lock.yaml',
    ],
    7000,
  );
  const excerpts = loadPullRequestFileExcerpts(
    prNumber,
    files.map((file) => file.filename),
    8,
    5000,
  );

  let followUpContext = 'None.';
  if (isFollowUpReview && latestBotReviewId) {
    const review = runGh(['api', `repos/${repo}/pulls/${prNumber}/reviews/${latestBotReviewId}`]);
    const reviewComments = runGh([
      'api',
      `repos/${repo}/pulls/${prNumber}/reviews/${latestBotReviewId}/comments`,
    ]);
    let compareDiff = '';
    if (latestBotReviewCommit && latestBotReviewCommit !== currentHeadSha) {
      compareDiff = runGh([
        'api',
        '-H',
        'Accept: application/vnd.github.v3.diff',
        `repos/${repo}/compare/${latestBotReviewCommit}...${currentHeadSha}`,
      ]);
    }
    followUpContext = [
      'Previous bot review:',
      truncate(review, 8000, 'previous review'),
      'Previous bot review comments:',
      truncate(reviewComments, 8000, 'previous review comments'),
      compareDiff
        ? `Compare diff since previous review:\n${truncate(compareDiff, 24000, 'compare diff')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const userPrompt = [
    `Repo: ${repo}`,
    `PR number: ${prNumber}`,
    `Current head SHA: ${currentHeadSha}`,
    `Review mode hint: ${isFollowUpReview ? 'follow-up after new commits' : 'initial'}`,
    '',
    'PR metadata:',
    JSON.stringify(prMeta, null, 2),
    '',
    'Repository docs:',
    serializeDocs(docs),
    '',
    'Changed files and patches:',
    serializeFiles(files),
    '',
    'PR head file excerpts:',
    serializeExcerpts(excerpts),
    '',
    'Unified diff:',
    truncate(diff, 140000, 'PR diff'),
    '',
    'Follow-up context:',
    followUpContext,
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
  const liveHeadSha = runGh([
    'pr',
    'view',
    prNumber,
    '-R',
    repo,
    '--json',
    'headRefOid',
    '-q',
    '.headRefOid',
  ]);
  if (liveHeadSha !== currentHeadSha) {
    console.log(`PR head moved from ${currentHeadSha} to ${liveHeadSha}; skipping stale review.`);
    return;
  }

  const reviewPayload = writeTempJson('deepseek-pr-review', {
    event: 'COMMENT',
    commit_id: currentHeadSha,
    body,
  });
  runGh([
    'api',
    `repos/${repo}/pulls/${prNumber}/reviews`,
    '--method',
    'POST',
    '--input',
    reviewPayload,
  ]);
  printUsage('DeepSeek PR review', usage);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
