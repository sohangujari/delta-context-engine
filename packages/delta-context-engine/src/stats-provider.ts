import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

interface StatsData {
  filesIndexed: number;
  edges: number;
  embeddings: number;
  avgCompression: number;
  lastIndexed: string;
}

export class DeltaStatsProvider
  implements vscode.TreeDataProvider<StatsTreeItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<StatsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private stats: StatsData | null = null;
  private deltaPath: string;
  private nodePath: string;
  private resolvedRoot: string;

  constructor(private workspaceRoot: string) {
    this.resolvedRoot = workspaceRoot;
    this.deltaPath = this.findDeltaCli(workspaceRoot);
    this.nodePath = this.findNode();
  }

  private findDeltaCli(startDir: string): string {
    let current = startDir;
    const root = path.parse(current).root;

    while (current !== root) {
      const candidate = path.join(
        current,
        'dist',
        'integrations',
        'cli',
        'index.js'
      );
      if (fs.existsSync(candidate)) {
        this.resolvedRoot = current;
        return candidate;
      }
      current = path.dirname(current);
    }

    return '';
  }

  private findNode(): string {
    const home = process.env['HOME'] ?? '';
    const candidates = [
      path.join(home, '.nvm', 'versions', 'node', 'v20.20.2', 'bin', 'node'),
      path.join(home, '.nvm', 'versions', 'node', 'v20.19.1', 'bin', 'node'),
      path.join(home, '.nvm', 'versions', 'node', 'v20.18.0', 'bin', 'node'),
      '/opt/homebrew/opt/node@20/bin/node',
      '/usr/local/opt/node@20/bin/node',
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? 'node';
  }

  refresh(): void {
    void this.loadStats();
  }

  private async loadStats(): Promise<void> {
    if (!this.deltaPath) {
      this._onDidChangeTreeData.fire();
      return;
    }
    try {
      const { stdout } = await execFileAsync(
        this.nodePath,
        [this.deltaPath, 'stats', '--root', this.resolvedRoot],
        { cwd: this.resolvedRoot, timeout: 10_000 }
      );
      this.stats = parseStats(stdout);
      this._onDidChangeTreeData.fire();
    } catch {
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: StatsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatsTreeItem): StatsTreeItem[] {
    if (element) return [];

    if (!this.stats) {
      return [new StatsTreeItem('Run: delta init to index project', '')];
    }

    return [
      new StatsTreeItem('Files indexed',     String(this.stats.filesIndexed)),
      new StatsTreeItem('Dependency edges',  String(this.stats.edges)),
      new StatsTreeItem('Embeddings',        String(this.stats.embeddings)),
      new StatsTreeItem('Avg compression',   `${this.stats.avgCompression}%`),
      new StatsTreeItem('Last indexed',      this.stats.lastIndexed),
    ];
  }
}

class StatsTreeItem extends vscode.TreeItem {
  constructor(label: string, value: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.tooltip = `${label}: ${value}`;
  }
}

function parseStats(output: string): StatsData {
  const filesMatch       = output.match(/Files indexed:\s+([\d,]+)/);
  const edgesMatch       = output.match(/Dependency edges:\s+([\d,]+)/);
  const embeddingsMatch  = output.match(/Embeddings:\s+([\d,]+)/);
  const compressionMatch = output.match(/Avg compression:\s+(\d+)%/);
  const lastMatch        = output.match(/Last indexed:\s+(.+)/);

  return {
    filesIndexed:   parseInt((filesMatch?.[1]      ?? '0').replace(/,/g, ''), 10),
    edges:          parseInt((edgesMatch?.[1]       ?? '0').replace(/,/g, ''), 10),
    embeddings:     parseInt((embeddingsMatch?.[1]  ?? '0').replace(/,/g, ''), 10),
    avgCompression: parseInt(compressionMatch?.[1]  ?? '0', 10),
    lastIndexed:    lastMatch?.[1]?.trim()          ?? 'never',
  };
}