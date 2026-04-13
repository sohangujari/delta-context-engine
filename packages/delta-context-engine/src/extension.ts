import * as vscode from 'vscode';
import { DeltaStatusBar } from './status-bar';
import { DeltaManifestProvider } from './manifest-provider';
import { DeltaStatsProvider } from './stats-provider';
import { DeltaTaskPanel } from './task-panel';
import { DeltaRunner } from './delta-runner';

let statusBar: DeltaStatusBar | undefined;
let runner: DeltaRunner | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    return;
  }

  runner = new DeltaRunner(workspaceRoot);
  statusBar = new DeltaStatusBar();
  context.subscriptions.push(statusBar);

  const manifestProvider = new DeltaManifestProvider();
  const statsProvider = new DeltaStatsProvider(workspaceRoot);

  vscode.window.registerTreeDataProvider('delta.manifestView', manifestProvider);
  vscode.window.registerTreeDataProvider('delta.statsView', statsProvider);

  // ── Commands ────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.init', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '∆ Delta: Initializing...',
          cancellable: false,
        },
        async () => {
          const result = await runner!.init();
          if (result.success) {
            vscode.window.showInformationMessage(
              `∆ Delta initialized successfully`
            );
            statsProvider.refresh();
          } else {
            vscode.window.showErrorMessage(
              `∆ Delta init failed: ${result.error}`
            );
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.run', async () => {
      const task = await vscode.window.showInputBox({
        prompt: 'Describe your task',
        placeHolder: 'e.g. fix the JWT expiry bug in login',
      });

      if (!task) return;

      const config = vscode.workspace.getConfiguration('delta');
      const budget = config.get<number>('tokenBudget', 2000);

      statusBar?.setLoading();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '∆ Delta: Assembling context...',
          cancellable: false,
        },
        async () => {
          const result = await runner!.run(task, budget);

          if (result.success && result.payload) {
            statusBar?.update(result.payload);
            manifestProvider.update(result.payload.manifest);
            statsProvider.refresh();

            const doc = await vscode.workspace.openTextDocument({
              content: result.payload.formatted,
              language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, {
              preview: true,
              viewColumn: vscode.ViewColumn.Beside,
            });

            vscode.window.showInformationMessage(
              `∆ Delta: ${result.payload.savings.reductionPercent}% reduction · ` +
              `${result.payload.savings.optimizedTokens.toLocaleString()} tokens`
            );
          } else {
            statusBar?.setError();
            vscode.window.showErrorMessage(
              `∆ Delta run failed: ${result.error}`
            );
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.stats', async () => {
      const result = await runner!.stats();
      if (result.success) {
        vscode.window.showInformationMessage(
          `∆ Delta Stats: ${result.output}`
        );
      }
      statsProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.refresh', () => {
      manifestProvider.refresh();
      statsProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.watch', async () => {
      const result = await runner!.startWatch();
      if (result.success) {
        statusBar?.setWatching();
        vscode.window.showInformationMessage('∆ Delta: Watch mode started');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.stopWatch', () => {
      runner!.stopWatch();
      statusBar?.setIdle();
      vscode.window.showInformationMessage('∆ Delta: Watch mode stopped');
    })
  );

  const config = vscode.workspace.getConfiguration('delta');
  if (config.get<boolean>('autoWatch', false)) {
    void vscode.commands.executeCommand('delta.watch');
  }

  statsProvider.refresh();
}

export function deactivate(): void {
  runner?.stopWatch();
  statusBar?.dispose();
}
