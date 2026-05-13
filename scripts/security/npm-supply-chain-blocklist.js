#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXIT_PASS = 0;
const EXIT_ESCALATE = 2;
const EXIT_BLOCK = 3;

const ROOT_RELATIVE_GUARD_FILES = new Set([
  'scripts/security/npm-supply-chain-blocklist.js',
  'scripts/security/npm-supply-chain-blocklist.json',
]);

const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const PACKAGE_MANIFEST = 'package.json';
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.md',
  '.mjs',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(EXIT_PASS);
  }

  const scriptDir = __dirname;
  const blocklist = JSON.parse(
    fs.readFileSync(path.join(scriptDir, 'npm-supply-chain-blocklist.json'), 'utf8'),
  );
  const repoRoot = path.resolve(args.repo || process.cwd());
  const context = createScanContext(blocklist);

  const result = args.full
    ? scanFullRepository(repoRoot, context, args.files)
    : scanDiffOrDefault(repoRoot, context, args);

  printReport(result);
  process.exit(result.exitCode);
}

function parseArgs(argv) {
  const args = {
    base: undefined,
    files: [],
    full: false,
    head: 'HEAD',
    help: false,
    repo: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--base':
        args.base = requireValue(argv, (index += 1), arg);
        break;
      case '--files':
        args.files = requireValue(argv, (index += 1), arg)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case '--full':
        args.full = true;
        break;
      case '--head':
        args.head = requireValue(argv, (index += 1), arg);
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--repo':
        args.repo = requireValue(argv, (index += 1), arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function printHelp() {
  console.log(`npm supply-chain blocklist gate

Usage:
  node scripts/security/npm-supply-chain-blocklist.js
  node scripts/security/npm-supply-chain-blocklist.js --base origin/main --head HEAD
  node scripts/security/npm-supply-chain-blocklist.js --full

Options:
  --base <rev>   Scan additions in git diff <rev>...<head>.
  --head <rev>   Diff head revision. Defaults to HEAD.
  --full         Scan tracked lockfiles, package manifests, workflows, and text files.
  --files <csv>  With --full, scan only the comma-separated file list.
  --repo <path>  Repository root to scan. Defaults to the current working directory.

Exit codes:
  0 PASS
  2 ESCALATE affected namespace or workflow/install risk
  3 BLOCK known compromised version or IOC marker
`);
}

function createScanContext(blocklist) {
  return {
    affectedMatchers: blocklist.affectedPackages.map((entry) => ({
      label: entry.name || entry.pattern,
      matches: entry.name ? exactPackageMatcher(entry.name) : globPackageMatcher(entry.pattern),
    })),
    blocklist,
    compromisedByName: new Map(
      blocklist.compromisedPackages.map((entry) => [entry.name, new Set(entry.versions)]),
    ),
    minimumBlockedVersions: new Map(
      (blocklist.minimumBlockedVersions || []).map((entry) => [entry.name, entry]),
    ),
  };
}

function scanDiffOrDefault(repoRoot, context, args) {
  const base = args.base || resolveDefaultBase(repoRoot);

  if (!base) {
    return scanFullRepository(repoRoot, context, args.files);
  }

  const changedFiles = parseChangedFiles(repoRoot, base, args.head);
  const lineMap = parseAddedLines(repoRoot, base, args.head);
  const findings = [];

  for (const file of changedFiles) {
    const normalized = normalizePath(file);

    if (shouldIgnoreFile(normalized)) {
      continue;
    }

    const addedLines = lineMap.get(normalized) || [];

    for (const addedLine of addedLines) {
      scanLineForIoc(findings, context, normalized, addedLine.number, addedLine.text);

      if (isPackageSecurityFile(normalized)) {
        scanLineForPackageRisks(findings, context, normalized, addedLine.number, addedLine.text);
        scanLineForInstallScriptRisk(findings, normalized, addedLine.number, addedLine.text);
      }

      if (isWorkflowFile(normalized)) {
        scanWorkflowLineRisk(findings, normalized, addedLine.number, addedLine.text);
      }
    }

    if (isPackageSecurityFile(normalized)) {
      const content = readTextIfPresent(repoRoot, normalized);
      scanStructuredPackageFile(findings, context, normalized, content, addedLines);
    }

    if (isWorkflowFile(normalized)) {
      const content = readTextIfPresent(repoRoot, normalized);
      scanWorkflowComboRisk(findings, normalized, content, addedLines);
    }
  }

  return toResult('diff', base, args.head, findings);
}

function scanFullRepository(repoRoot, context, files) {
  const targetFiles = files.length > 0 ? files : listTrackedFiles(repoRoot);
  const findings = [];

  for (const file of targetFiles) {
    const normalized = normalizePath(file);

    if (shouldIgnoreFile(normalized) || !shouldScanTextFile(normalized)) {
      continue;
    }

    const content = readTextIfPresent(repoRoot, normalized);

    if (!content) {
      continue;
    }

    const lines = splitLines(content);

    for (let index = 0; index < lines.length; index += 1) {
      const lineNumber = index + 1;
      const line = lines[index];

      scanLineForIoc(findings, context, normalized, lineNumber, line);

      if (isPackageSecurityFile(normalized)) {
        scanLineForPackageRisks(findings, context, normalized, lineNumber, line);
        scanLineForInstallScriptRisk(findings, normalized, lineNumber, line);
      }

      if (isWorkflowFile(normalized)) {
        scanWorkflowLineRisk(findings, normalized, lineNumber, line);
      }
    }

    if (isPackageSecurityFile(normalized)) {
      scanStructuredPackageFile(findings, context, normalized, content, undefined);
    }

    if (isWorkflowFile(normalized)) {
      scanWorkflowComboRisk(findings, normalized, content, undefined);
    }
  }

  return toResult('full', undefined, undefined, findings);
}

function parseChangedFiles(repoRoot, base, head) {
  const output = runGit(repoRoot, [
    'diff',
    '--name-only',
    '--diff-filter=ACMRT',
    `${base}...${head}`,
  ]);

  return output
    .split('\n')
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function parseAddedLines(repoRoot, base, head) {
  const output = runGit(repoRoot, [
    'diff',
    '--unified=0',
    '--no-ext-diff',
    '--find-renames',
    `${base}...${head}`,
  ]);
  const byFile = new Map();
  let currentFile = undefined;
  let newLine = 0;

  for (const rawLine of output.split('\n')) {
    if (rawLine.startsWith('+++ b/')) {
      currentFile = normalizePath(rawLine.slice('+++ b/'.length));
      if (!byFile.has(currentFile)) {
        byFile.set(currentFile, []);
      }
      continue;
    }

    if (rawLine.startsWith('+++ /dev/null')) {
      currentFile = undefined;
      continue;
    }

    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/\+(\d+)(?:,(\d+))?/);
      newLine = match ? Number(match[1]) : 0;
      continue;
    }

    if (!currentFile || rawLine.startsWith('diff --git') || rawLine.startsWith('--- ')) {
      continue;
    }

    if (rawLine.startsWith('+')) {
      byFile.get(currentFile).push({ number: newLine, text: rawLine.slice(1) });
      newLine += 1;
      continue;
    }

    if (!rawLine.startsWith('-') && !rawLine.startsWith('\\')) {
      newLine += 1;
    }
  }

  return byFile;
}

function resolveDefaultBase(repoRoot) {
  const envBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined;
  const candidates = [envBase, 'origin/main', 'origin/dev/v0.2', 'main', 'dev/v0.2'].filter(
    Boolean,
  );

  for (const candidate of candidates) {
    if (!gitRevExists(repoRoot, candidate)) {
      continue;
    }

    const mergeBase = runGit(repoRoot, ['merge-base', 'HEAD', candidate], {
      allowFailure: true,
    }).trim();

    if (mergeBase) {
      return mergeBase;
    }
  }

  return undefined;
}

function gitRevExists(repoRoot, rev) {
  return (
    runGit(repoRoot, ['rev-parse', '--verify', `${rev}^{commit}`], {
      allowFailure: true,
    }).trim() !== ''
  );
}

function runGit(repoRoot, args, options = {}) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', options.allowFailure ? 'ignore' : 'pipe'],
    });
  } catch (error) {
    if (options.allowFailure) {
      return '';
    }

    throw error;
  }
}

function listTrackedFiles(repoRoot) {
  return runGit(repoRoot, ['ls-files'])
    .split('\n')
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function readTextIfPresent(repoRoot, relativeFile) {
  const fullPath = path.isAbsolute(relativeFile)
    ? relativeFile
    : path.join(repoRoot, normalizePath(relativeFile));

  if (!fs.existsSync(fullPath)) {
    return '';
  }

  const stat = fs.statSync(fullPath);

  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) {
    return '';
  }

  const buffer = fs.readFileSync(fullPath);

  if (buffer.includes(0)) {
    return '';
  }

  return buffer.toString('utf8');
}

function scanLineForIoc(findings, context, file, lineNumber, line) {
  for (const entry of context.blocklist.iocMarkers) {
    if (line.includes(entry.marker)) {
      addFinding(findings, {
        code: 'ioc-marker',
        file,
        line: lineNumber,
        message: `IOC marker "${entry.marker}" is blocked until investigated.`,
        severity: 'BLOCK',
      });
    }
  }

  if (
    context.blocklist.workflowRisk.blockCodeqlSecretsDump &&
    normalizePath(file) === '.github/workflows/codeql_analysis.yml' &&
    line.includes('toJSON(secrets)')
  ) {
    addFinding(findings, {
      code: 'codeql-secrets-dump',
      file,
      line: lineNumber,
      message: 'Unexpected CodeQL workflow secrets dump via toJSON(secrets).',
      severity: 'BLOCK',
    });
  }
}

function scanLineForPackageRisks(findings, context, file, lineNumber, line) {
  for (const [packageName, versions] of context.compromisedByName.entries()) {
    if (!lineMentionsExactPackage(line, packageName)) {
      continue;
    }

    const version = extractVersionNearPackage(line, packageName);

    if (version && isPackageVersionBlocked(context, packageName, version)) {
      addBlockedPackageFinding(findings, file, lineNumber, packageName, version);
      continue;
    }

    for (const blockedVersion of versions) {
      if (line.includes(blockedVersion)) {
        addBlockedPackageFinding(findings, file, lineNumber, packageName, blockedVersion);
      }
    }
  }

  for (const matcher of context.affectedMatchers) {
    if (!matcher.matches(line)) {
      continue;
    }

    const packageName = extractPackageNameForMatcher(line, matcher) || matcher.label;
    const version = extractVersionNearPackage(line, packageName);

    if (version && isPackageVersionBlocked(context, packageName, version)) {
      addBlockedPackageFinding(findings, file, lineNumber, packageName, version);
      continue;
    }

    addFinding(findings, {
      code: 'affected-package',
      file,
      line: lineNumber,
      message: `Affected package namespace hit (${packageName}); security review is required before merge.`,
      severity: 'ESCALATE',
    });
  }
}

function scanStructuredPackageFile(findings, context, file, content, addedLines) {
  if (!content || !file.endsWith('.json')) {
    return;
  }

  let parsed;

  try {
    parsed = JSON.parse(content);
  } catch (_error) {
    return;
  }

  const entries = file.endsWith(PACKAGE_MANIFEST)
    ? packageEntriesFromManifest(parsed)
    : packageEntriesFromPackageLock(parsed);
  const addedLineTexts = addedLines ? addedLines.map((line) => line.text) : undefined;
  const addedLineNumbers = new Set((addedLines || []).map((line) => line.number));

  for (const entry of entries) {
    const lineNumber = findPackageLine(content, entry.name) || 1;

    if (
      addedLines &&
      !shouldEvaluateStructuredEntry(entry, lineNumber, addedLineNumbers, addedLineTexts)
    ) {
      continue;
    }

    if (entry.version && isPackageVersionBlocked(context, entry.name, entry.version)) {
      addBlockedPackageFinding(findings, file, lineNumber, entry.name, entry.version);
      continue;
    }

    if (matchesAnyAffectedPackage(context, entry.name)) {
      addFinding(findings, {
        code: 'affected-package',
        file,
        line: lineNumber,
        message: `Affected package namespace hit (${entry.name}); security review is required before merge.`,
        severity: 'ESCALATE',
      });
    }
  }
}

function packageEntriesFromManifest(parsed) {
  const sections = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];
  const entries = [];

  for (const section of sections) {
    const value = parsed[section];

    if (!value || typeof value !== 'object') {
      continue;
    }

    if (Array.isArray(value)) {
      for (const packageName of value) {
        if (typeof packageName === 'string') {
          entries.push({ name: packageName, version: undefined });
        }
      }
      continue;
    }

    for (const [packageName, version] of Object.entries(value)) {
      entries.push({ name: packageName, version: normalizeVersion(String(version)) });
    }
  }

  return entries;
}

function packageEntriesFromPackageLock(parsed) {
  const entries = [];

  if (parsed.packages && typeof parsed.packages === 'object') {
    for (const [packagePath, metadata] of Object.entries(parsed.packages)) {
      if (!packagePath.startsWith('node_modules/') || !metadata || typeof metadata !== 'object') {
        continue;
      }

      const packageName = packagePath.slice('node_modules/'.length);
      entries.push({
        name: packageName,
        version: normalizeVersion(String(metadata.version || '')),
      });
    }
  }

  if (parsed.dependencies && typeof parsed.dependencies === 'object') {
    collectPackageLockDependencies(parsed.dependencies, entries);
  }

  return entries;
}

function collectPackageLockDependencies(dependencies, entries) {
  for (const [packageName, metadata] of Object.entries(dependencies)) {
    if (!metadata || typeof metadata !== 'object') {
      continue;
    }

    entries.push({ name: packageName, version: normalizeVersion(String(metadata.version || '')) });

    if (metadata.dependencies && typeof metadata.dependencies === 'object') {
      collectPackageLockDependencies(metadata.dependencies, entries);
    }
  }
}

function shouldEvaluateStructuredEntry(entry, lineNumber, addedLineNumbers, addedLineTexts) {
  if (addedLineNumbers.has(lineNumber)) {
    return true;
  }

  return addedLineTexts.some((line) => {
    if (line.includes(entry.name)) {
      return true;
    }

    return Boolean(entry.version && line.includes(entry.version));
  });
}

function scanLineForInstallScriptRisk(findings, file, lineNumber, line) {
  if (!/^\s*(requiresBuild|hasBin):\s*true\s*$/.test(line)) {
    return;
  }

  addFinding(findings, {
    code: 'install-script-capable-resolution',
    file,
    line: lineNumber,
    message:
      'Dependency resolution changed for a package that can execute install/build scripts in CI.',
    severity: 'ESCALATE',
  });
}

function scanWorkflowLineRisk(findings, file, lineNumber, line) {
  const trimmed = line.trim();

  if (/pnpm\s+(install|i)\b/.test(trimmed)) {
    if (trimmed.includes('--no-frozen-lockfile')) {
      addFinding(findings, {
        code: 'pnpm-no-frozen-lockfile',
        file,
        line: lineNumber,
        message:
          'pnpm install uses --no-frozen-lockfile; lockfile discipline requires frozen installs.',
        severity: 'ESCALATE',
      });
      return;
    }

    if (!trimmed.includes('--frozen-lockfile')) {
      addFinding(findings, {
        code: 'pnpm-bare-install',
        file,
        line: lineNumber,
        message:
          'Bare pnpm install in CI can rewrite dependency resolution; use --frozen-lockfile.',
        severity: 'ESCALATE',
      });
    }
  }

  if (/\bnpm\s+install\b/.test(trimmed)) {
    addFinding(findings, {
      code: 'npm-bare-install',
      file,
      line: lineNumber,
      message:
        'Bare npm install in CI can rewrite dependency resolution; use npm ci for frozen installs.',
      severity: 'ESCALATE',
    });
  }

  if (/\bnpm\s+ci\b/.test(trimmed)) {
    addFinding(findings, {
      code: 'npm-ci-install-change',
      file,
      line: lineNumber,
      message:
        'npm ci install behavior changed; confirm the lockfile diff was scanned and remains frozen.',
      severity: 'ESCALATE',
    });
  }

  if (/^\s*pull_request_target\s*:/.test(line)) {
    addFinding(findings, {
      code: 'pull-request-target-change',
      file,
      line: lineNumber,
      message:
        'pull_request_target workflow behavior changed; review fork checkout, token, cache, and install boundaries.',
      severity: 'ESCALATE',
    });
  }

  if (/id-token\s*:\s*write/.test(line)) {
    addFinding(findings, {
      code: 'oidc-token-write-change',
      file,
      line: lineNumber,
      message:
        'id-token: write was changed; confirm no package install or publish path can reach OIDC credentials.',
      severity: 'ESCALATE',
    });
  }

  if (/actions\/cache|cache\s*:|cache-dependency-path|restore-keys\s*:|key\s*:/.test(line)) {
    addFinding(findings, {
      code: 'workflow-cache-change',
      file,
      line: lineNumber,
      message: 'Workflow cache behavior changed; review cache key poisoning and fork boundaries.',
      severity: 'ESCALATE',
    });
  }
}

function scanWorkflowComboRisk(findings, file, content, addedLines) {
  if (!content) {
    return;
  }

  const relevantChangeLine = firstRelevantWorkflowChange(addedLines);

  if (addedLines && !relevantChangeLine) {
    return;
  }

  const hasPullRequestTarget = /^\s*pull_request_target\s*:/m.test(content);
  const hasIdTokenWrite = /id-token\s*:\s*write/.test(content);
  const hasCache = /actions\/cache|cache\s*:|cache-dependency-path|restore-keys\s*:|key\s*:/.test(
    content,
  );
  const hasForkCheckout =
    /github\.event\.pull_request\.head|pull_request\.head\.repo|refs\/pull\/\$\{\{\s*github\.event\.pull_request\.number\s*\}\}\/head|ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/.test(
      content,
    );

  if (hasPullRequestTarget && hasIdTokenWrite && hasCache && hasForkCheckout) {
    addFinding(findings, {
      code: 'pull-request-target-cache-oidc',
      file,
      line: relevantChangeLine ? relevantChangeLine.number : 1,
      message:
        'Workflow combines pull_request_target, fork-head checkout, cache behavior, and id-token: write.',
      severity: 'ESCALATE',
    });
  }
}

function firstRelevantWorkflowChange(addedLines) {
  if (!addedLines) {
    return undefined;
  }

  return addedLines.find((line) =>
    /pull_request_target|id-token\s*:|actions\/cache|cache\s*:|cache-dependency-path|restore-keys\s*:|key\s*:|pull_request\.head|refs\/pull|pnpm\s+(install|i)\b|npm\s+(install|ci)\b|--no-frozen-lockfile/.test(
      line.text,
    ),
  );
}

function addBlockedPackageFinding(findings, file, line, packageName, version) {
  addFinding(findings, {
    code: 'compromised-package-version',
    file,
    line,
    message: `${packageName}@${version} is blocked by the npm supply-chain blocklist.`,
    severity: 'BLOCK',
  });
}

function isPackageVersionBlocked(context, packageName, version) {
  const normalizedVersion = normalizeVersion(version);

  if (!normalizedVersion) {
    return false;
  }

  const exactVersions = context.compromisedByName.get(packageName);

  if (exactVersions && exactVersions.has(normalizedVersion)) {
    return true;
  }

  const minimum = context.minimumBlockedVersions.get(packageName);

  return Boolean(minimum && compareSemver(normalizedVersion, minimum.minimumVersion) >= 0);
}

function matchesAnyAffectedPackage(context, packageName) {
  return context.affectedMatchers.some((matcher) => matcher.matches(packageName));
}

function lineMentionsExactPackage(line, packageName) {
  const escaped = escapeRegExp(packageName);
  return new RegExp(`(^|[^A-Za-z0-9._/-])${escaped}([^A-Za-z0-9._/-]|$)`).test(line);
}

function extractPackageNameForMatcher(line, matcher) {
  if (
    matcher.label &&
    !matcher.label.includes('*') &&
    lineMentionsExactPackage(line, matcher.label)
  ) {
    return matcher.label;
  }

  const candidates = line.match(
    /@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|(?<![@/])\b[A-Za-z0-9][A-Za-z0-9._-]*\b/g,
  );

  if (!candidates) {
    return undefined;
  }

  return candidates.find((candidate) => matcher.matches(candidate));
}

function extractVersionNearPackage(line, packageName) {
  if (!packageName || packageName.includes('*')) {
    return undefined;
  }

  const escapedName = escapeRegExp(packageName);
  const patterns = [
    new RegExp(`${escapedName}@([^\\s'":,}()]+)`),
    new RegExp(`${escapedName}['"]?\\s*:\\s*['"]?([^\\s'",}]+)`),
    new RegExp(`node_modules/${escapedName}['"]?\\s*:\\s*\\{[^\\n]*"version"\\s*:\\s*"([^"]+)"`),
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);

    if (match) {
      return normalizeVersion(match[1]);
    }
  }

  return undefined;
}

function exactPackageMatcher(packageName) {
  return (lineOrPackageName) => lineMentionsExactPackage(lineOrPackageName, packageName);
}

function globPackageMatcher(pattern) {
  const regex = new RegExp(
    `(^|[^A-Za-z0-9._/-])${pattern
      .split('*')
      .map(escapeRegExp)
      .join('[A-Za-z0-9._/-]*')}([^A-Za-z0-9._/-]|$)`,
  );

  return (lineOrPackageName) => regex.test(lineOrPackageName);
}

function normalizeVersion(version) {
  const match = String(version)
    .trim()
    .match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);

  return match ? match[1] : undefined;
}

function compareSemver(left, right) {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }

    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }

  return 0;
}

function semverParts(version) {
  return String(version)
    .split(/[+-]/)[0]
    .split('.')
    .slice(0, 3)
    .map((part) => Number(part) || 0);
}

function findPackageLine(content, packageName) {
  const lines = splitLines(content);

  for (let index = 0; index < lines.length; index += 1) {
    if (lineMentionsExactPackage(lines[index], packageName)) {
      return index + 1;
    }
  }

  return undefined;
}

function addFinding(findings, finding) {
  const key = `${finding.severity}|${finding.code}|${finding.file}|${finding.line}|${finding.message}`;

  if (findings.some((existing) => existing.key === key)) {
    return;
  }

  findings.push({ ...finding, key });
}

function toResult(mode, base, head, findings) {
  const sortedFindings = findings
    .slice()
    .sort((left, right) =>
      left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
    );
  const hasBlock = sortedFindings.some((finding) => finding.severity === 'BLOCK');
  const hasEscalate = sortedFindings.some((finding) => finding.severity === 'ESCALATE');

  return {
    base,
    exitCode: hasBlock ? EXIT_BLOCK : hasEscalate ? EXIT_ESCALATE : EXIT_PASS,
    findings: sortedFindings,
    head,
    mode,
    status: hasBlock ? 'BLOCK' : hasEscalate ? 'ESCALATE' : 'PASS',
  };
}

function printReport(result) {
  console.log(`npm supply-chain blocklist gate: ${result.status}`);
  console.log(`mode: ${result.mode}`);

  if (result.base) {
    console.log(`diff: ${result.base}...${result.head}`);
  }

  if (result.findings.length === 0) {
    console.log('findings: none');
    console.log('exit: 0');
    return;
  }

  console.log('findings:');

  for (const finding of result.findings) {
    console.log(
      `- ${finding.severity} ${finding.file}:${finding.line} ${finding.code}: ${finding.message}`,
    );
  }

  console.log(`exit: ${result.exitCode}`);
}

function isPackageSecurityFile(file) {
  const baseName = path.basename(file);
  return LOCKFILES.has(baseName) || baseName === PACKAGE_MANIFEST;
}

function isWorkflowFile(file) {
  const normalized = normalizePath(file);
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized);
}

function shouldScanTextFile(file) {
  if (isPackageSecurityFile(file) || isWorkflowFile(file)) {
    return true;
  }

  return TEXT_EXTENSIONS.has(path.extname(file));
}

function shouldIgnoreFile(file) {
  const normalized = normalizePath(file);

  if (ROOT_RELATIVE_GUARD_FILES.has(normalized)) {
    return true;
  }

  return normalized.includes('/node_modules/') || normalized.startsWith('node_modules/');
}

function normalizePath(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

function splitLines(content) {
  return content.split(/\r?\n/);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
