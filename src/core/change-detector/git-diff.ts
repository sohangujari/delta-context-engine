import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'path';
import { loadIgnorePatterns, shouldIgnore } from '../../config/deltaignore.js';

export interface GitDiffResult {
  changedFiles: string[];
  isGitRepo: boolean;
  error?: string;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java',
]);

function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export async function getGitChangedFiles(
  projectRoot: string
): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(projectRoot);
  const ignorePatterns = loadIgnorePatterns(projectRoot);

  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    return { changedFiles: [], isGitRepo: false };
  }

  function filterFile(filePath: string): boolean {
    if (!isSupportedFile(filePath)) return false;

    // Hard exclude — check relative path prefix directly
    const relative = path.relative(projectRoot, filePath);
    const normalized = relative.replace(/\\/g, '/');

    // Exclude anything under packages/
    if (normalized.startsWith('packages/')) return false;

    // Exclude anything under .delta/
    if (normalized.startsWith('.delta/')) return false;

    // Exclude anything under .claude/
    if (normalized.startsWith('.claude/')) return false;

    // Apply full ignore pattern matching
    if (shouldIgnore(filePath, ignorePatterns, projectRoot)) return false;

    return true;
  }

  try {
    const diffSummary = await git.diffSummary(['HEAD']);
    const changedFromHead = diffSummary.files
      .map((f) => path.resolve(projectRoot, f.file))
      .filter(filterFile);

    const status = await git.status();
    const untracked = status.not_added
      .map((f) => path.resolve(projectRoot, f))
      .filter(filterFile);

    const staged = status.created
      .map((f) => path.resolve(projectRoot, f))
      .filter(filterFile);

    const all = [...new Set([...changedFromHead, ...untracked, ...staged])];

    return { changedFiles: all, isGitRepo: true };
  } catch (err) {
    if (isInitialCommit(err)) {
      return await getAllTrackedFiles(git, projectRoot, filterFile);
    }

    return {
      changedFiles: [],
      isGitRepo: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isInitialCommit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('unknown revision') ||
    msg.includes('does not have any commits') ||
    msg.includes("ambiguous argument 'HEAD'")
  );
}

async function getAllTrackedFiles(
  git: SimpleGit,
  projectRoot: string,
  filterFile: (f: string) => boolean
): Promise<GitDiffResult> {
  try {
    const status = await git.status();
    const files = [
      ...status.created,
      ...status.not_added,
      ...status.modified,
    ]
      .map((f) => path.resolve(projectRoot, f))
      .filter(filterFile);

    return { changedFiles: [...new Set(files)], isGitRepo: true };
  } catch {
    return { changedFiles: [], isGitRepo: true };
  }
}