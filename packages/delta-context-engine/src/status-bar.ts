import * as vscode from 'vscode';
import type { RunPayload } from './delta-runner';

export class DeltaStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'delta.run';
    this.setIdle();
    this.item.show();
  }

  setIdle(): void {
    this.item.text = '∆ Delta';
    this.item.tooltip = 'Click to run Delta context assembly';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  setLoading(): void {
    this.item.text = '∆ $(loading~spin) Assembling...';
    this.item.tooltip = 'Delta is assembling context...';
  }

  setWatching(): void {
    this.item.text = '∆ $(eye) Watching';
    this.item.tooltip = 'Delta watch mode active';
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
  }

  setError(): void {
    this.item.text = '∆ $(error) Error';
    this.item.tooltip = 'Delta encountered an error';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  update(payload: RunPayload): void {
    const { reductionPercent, optimizedTokens } = payload.savings;
    this.item.text = `∆ ${optimizedTokens.toLocaleString()} tok (-${reductionPercent}%)`;
    this.item.tooltip =
      `Delta: ${optimizedTokens.toLocaleString()} tokens sent\n` +
      `Saved ${payload.savings.savedTokens.toLocaleString()} tokens (${reductionPercent}% reduction)\n` +
      `Click to run again`;
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
