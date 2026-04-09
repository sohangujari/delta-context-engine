import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'path';

export interface GitDiffResult {
  changedFiles: string[];   // absolute paths
  isGitRepo: boolean;
  error?: string;
}

export async function getGitChangedFiles(
  projectRoot: string
): Promise<GitDiffResult> {
  const git: SimpleGit = simpleGit(projectRoot);

  // Check if this is a git repo at all
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    return { changedFiles: [], isGitRepo: false };
  }

  try {
    // Get files changed vs HEAD (staged + unstaged)
    const diffSummary = await git.diffSummary(['HEAD']);
    const changedFromHead = diffSummary.files.map((f) =>
      path.resolve(projectRoot, f.file)
    );

    // Also catch untracked files (new files not yet committed)
    const status = await git.status();
    const untracked = status.not_added.map((f) =>
      path.resolve(projectRoot, f)
    );

    // Also catch staged new files
    const staged = status.created.map((f) =>
      path.resolve(projectRoot, f)
    );

    const all = [...new Set([...changedFromHead, ...untracked, ...staged])];

    return { changedFiles: all, isGitRepo: true };
  } catch (err) {
    // Repo exists but no commits yet — treat everything as changed
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
    ].map((f) => path.resolve(projectRoot, f));

    return { changedFiles: [...new Set(files)], isGitRepo: true };
  } catch {
    return { changedFiles: [], isGitRepo: true };
  }
}