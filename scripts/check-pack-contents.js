import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');

function toPosixPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeFilesEntry(entry) {
  if (typeof entry !== 'string' || entry.trim().length === 0) {
    throw new Error(`package.json: "files" entries must be non-empty strings (got: ${JSON.stringify(entry)})`);
  }

  const normalized = toPosixPath(entry.trim());

  if (normalized.startsWith('/')) {
    throw new Error(`package.json: "files" entries must be relative paths (got: ${JSON.stringify(entry)})`);
  }

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`package.json: "files" entries must stay within the package root (got: ${JSON.stringify(entry)})`);
  }

  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`package.json: "files" entries must not contain ".." path segments (got: ${JSON.stringify(entry)})`);
  }

  const hasGlobChars = ['*', '?', '[', ']', '{', '}', '(', ')', '!'].some((c) => normalized.includes(c));
  if (hasGlobChars) {
    throw new Error(
      `package.json: "files" entries must be explicit files/dirs (no glob patterns). Move assets into a directory and allowlist the directory instead (got: ${JSON.stringify(entry)})`,
    );
  }

  return normalized;
}

function loadPackageJson() {
  const packageJsonPath = resolve(packageRoot, 'package.json');
  const raw = readFileSync(packageJsonPath, 'utf8');
  return JSON.parse(raw);
}

function getPackedFilePaths() {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0]?.files) {
    throw new Error(`Unexpected "npm pack --dry-run --json" output shape`);
  }

  return parsed[0].files.map((f) => toPosixPath(f.path));
}

function getBinTargets(packageJson) {
  const targets = [];

  if (typeof packageJson.bin === 'string') {
    targets.push(packageJson.bin);
  } else if (packageJson.bin && typeof packageJson.bin === 'object') {
    for (const value of Object.values(packageJson.bin)) {
      targets.push(value);
    }
  }

  return targets.map((t) => toPosixPath(t));
}

function main() {
  const packageJson = loadPackageJson();

  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    throw new Error('package.json must define a non-empty "files" allowlist for publishing');
  }

  const allowlistedEntries = packageJson.files.map(normalizeFilesEntry);
  const allowlistedExact = new Set(['package.json']);
  const allowlistedPrefixes = [];

  for (const entry of allowlistedEntries) {
    const absolute = resolve(packageRoot, entry);
    let stats;
    try {
      stats = statSync(absolute);
    } catch (error) {
      throw new Error(`package.json "files" entry does not exist: ${entry}`);
    }

    if (stats.isDirectory()) {
      allowlistedPrefixes.push(entry.endsWith('/') ? entry : `${entry}/`);
    } else {
      allowlistedExact.add(entry);
    }
  }

  const packedPaths = getPackedFilePaths();
  const packedSet = new Set(packedPaths);

  const unexpected = packedPaths
    .filter((p) => {
      if (allowlistedExact.has(p)) return false;
      return !allowlistedPrefixes.some((prefix) => p.startsWith(prefix));
    })
    .sort();

  const missingRequired = getBinTargets(packageJson)
    .filter((p) => !packedSet.has(p))
    .sort();

  if (unexpected.length > 0 || missingRequired.length > 0) {
    const lines = [];
    lines.push('npm pack allowlist check failed.');

    if (unexpected.length > 0) {
      lines.push('');
      lines.push('Unexpected paths in tarball:');
      for (const p of unexpected) lines.push(`- ${p}`);
    }

    if (missingRequired.length > 0) {
      lines.push('');
      lines.push('Missing required runtime files (bin targets):');
      for (const p of missingRequired) lines.push(`- ${p}`);
    }

    throw new Error(lines.join('\n'));
  }

  process.stdout.write('✓ npm pack contents match package.json "files" allowlist\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
