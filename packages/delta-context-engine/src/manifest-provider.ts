import * as vscode from 'vscode';
import type { ManifestItem } from './delta-runner';

export class DeltaManifestProvider implements vscode.TreeDataProvider<ManifestTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ManifestTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private items: ManifestItem[] = [];

  update(items: ManifestItem[]): void {
    this.items = items;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ManifestTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ManifestTreeItem): ManifestTreeItem[] {
    if (element) return [];
    if (this.items.length === 0) {
      return [new ManifestTreeItem('Run a task to see context manifest', 'info', 0, '')];
    }
    return this.items.map(
      (item) => new ManifestTreeItem(item.relativePath, item.compressionLevel, item.tokenCount, item.reason)
    );
  }
}

class ManifestTreeItem extends vscode.TreeItem {
  constructor(label: string, compressionLevel: string, tokenCount: number, reason: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    const icons: Record<string, string> = { full: '✅', symbols: '○', summary: '·', excluded: '✗', info: 'ℹ' };
    const icon = icons[compressionLevel] ?? '·';
    this.label = `${icon} ${label}`;
    this.description = tokenCount > 0 ? `${tokenCount} tok · ${compressionLevel}` : compressionLevel;
    this.tooltip = `${reason}\nCompression: ${compressionLevel}\nTokens: ${tokenCount}`;
    this.contextValue = compressionLevel;
  }
}
