/**
 * ∆ Delta Context Engine — VS Code Extension
 *
 * Provides `@delta` chat participant in Copilot Chat.
 * Users can type `@delta search auth` or `@delta blast src/auth.ts`
 * and get Delta-optimized context injected into the conversation.
 */

import * as vscode from 'vscode';
import { execSync, exec } from 'child_process';
import path from 'path';

const PARTICIPANT_ID = 'delta.chat';

export function activate(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    handleDeltaChat
  );

  participant.iconPath = new vscode.ThemeIcon('symbol-namespace');

  context.subscriptions.push(participant);
}

export function deactivate(): void {
  // nothing to clean up
}

// ── Chat Handler ──────────────────────────────────────────────────────────────

async function handleDeltaChat(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    stream.markdown('⚠ No workspace folder open. Delta needs a project root to work.');
    return;
  }

  const command = request.command;
  const query = request.prompt.trim();

  try {
    switch (command) {
      case 'context':
        await handleContext(query, workspaceRoot, stream, token);
        break;
      case 'search':
        await handleSearch(query, workspaceRoot, stream, token);
        break;
      case 'blast':
        await handleBlast(query, workspaceRoot, stream, token);
        break;
      case 'risk':
        await handleRisk(workspaceRoot, stream, token);
        break;
      case 'compass':
        await handleCompass(workspaceRoot, stream, token);
        break;
      case 'first-day':
        await handleFirstDay(workspaceRoot, stream, token);
        break;
      default:
        // No command — treat entire prompt as a context request
        await handleContext(query || 'general context', workspaceRoot, stream, token);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stream.markdown(`❌ Delta error: ${msg}`);
  }
}

// ── Command Handlers ──────────────────────────────────────────────────────────

async function handleContext(
  task: string,
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Getting optimized context...');

  if (token.isCancellationRequested) return;

  const output = runDeltaCli(
    `run "${escapeShell(task)}" --root "${escapeShell(root)}"`,
    root
  );

  stream.markdown('## ∆ Optimized Context\n\n');
  stream.markdown(output);
}

async function handleSearch(
  query: string,
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  if (!query) {
    stream.markdown('Usage: `@delta /search <query>`');
    return;
  }

  stream.progress(`Searching for "${query}"...`);

  if (token.isCancellationRequested) return;

  const output = runDeltaCli(
    `search "${escapeShell(query)}" --root "${escapeShell(root)}"`,
    root
  );

  stream.markdown('## ∆ Search Results\n\n');
  stream.markdown(output);
}

async function handleBlast(
  filePath: string,
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  // If no file specified, use the active editor's file
  const target = filePath || getActiveFilePath(root);
  if (!target) {
    stream.markdown('Usage: `@delta /blast <file>` or open a file first.');
    return;
  }

  stream.progress(`Calculating blast radius for ${target}...`);

  if (token.isCancellationRequested) return;

  const output = runDeltaCli(
    `blast "${escapeShell(target)}" --root "${escapeShell(root)}"`,
    root
  );

  stream.markdown('## ∆ Blast Radius\n\n');
  stream.markdown(output);
}

async function handleRisk(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Calculating risk scores...');

  if (token.isCancellationRequested) return;

  const output = runDeltaCli(
    `risk --root "${escapeShell(root)}"`,
    root
  );

  stream.markdown('## ∆ Risk Scores\n\n');
  stream.markdown(output);
}

async function handleCompass(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Analyzing architecture...');

  if (token.isCancellationRequested) return;

  const output = runDeltaCli(
    `communities --root "${escapeShell(root)}"`,
    root
  );

  stream.markdown('## ∆ Codebase Architecture\n\n');
  stream.markdown(output);
}

async function handleFirstDay(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Generating onboarding guide...');

  if (token.isCancellationRequested) return;

  // Use communities + flows + hubs for an overview
  const communities = runDeltaCli(`communities --root "${escapeShell(root)}"`, root);
  const flows = runDeltaCli(`flows --root "${escapeShell(root)}"`, root);
  const hubs = runDeltaCli(`hubs --root "${escapeShell(root)}"`, root);

  stream.markdown('## ∆ First Day Guide\n\n');
  stream.markdown('### Architecture\n\n');
  stream.markdown(communities);
  stream.markdown('\n\n### Key Execution Flows\n\n');
  stream.markdown(flows);
  stream.markdown('\n\n### Hub Files (most important)\n\n');
  stream.markdown(hubs);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

function getActiveFilePath(root: string): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  return path.relative(root, editor.document.uri.fsPath);
}

function runDeltaCli(args: string, cwd: string): string {
  try {
    const result = execSync(`npx delta-ctx ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    return result.trim();
  } catch (err) {
    if (err instanceof Error && 'stdout' in err) {
      const stdout = (err as { stdout?: string }).stdout;
      if (stdout) return stdout;
    }
    throw err;
  }
}

function escapeShell(str: string): string {
  return str.replace(/["\\\n\r]/g, (ch) => {
    switch (ch) {
      case '"': return '\\"';
      case '\\': return '\\\\';
      case '\n': return '\\n';
      case '\r': return '\\r';
      default: return ch;
    }
  });
}
