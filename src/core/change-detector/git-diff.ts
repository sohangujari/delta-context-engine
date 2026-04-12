import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'path';

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

  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    return { changedFiles: [], isGitRepo: false };
  }

  try {
    const diffSummary = await git.diffSummary(['HEAD']);
    const changedFromHead = diffSummary.files
      .map((f) => path.resolve(projectRoot, f.file))
      .filter(isSupportedFile);

    const status = await git.status();
    const untracked = status.not_added
      .map((f) => path.resolve(projectRoot, f))
      .filter(isSupportedFile);

    const staged = status.created
      .map((f) => path.resolve(projectRoot, f))
      .filter(isSupportedFile);

    const all = [...new Set([...changedFromHead, ...untracked, ...staged])];

    return { changedFiles: all, isGitRepo: true };
  } catch (err) {
    if (isInitialCommit(err)) {
      return await getAllTrackedFiles(git, projectRoot);
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
  projectRoot: string
): Promise<GitDiffResult> {
  try {
    const status = await git.status();
    const files = [
      ...status.created,
      ...status.not_added,
      ...status.modified,
    ]
      .map((f) => path.resolve(projectRoot, f))
      .filter(isSupportedFile);

    return { changedFiles: [...new Set(files)], isGitRepo: true };
  } catch {
    return { changedFiles: [], isGitRepo: true };
  }
}