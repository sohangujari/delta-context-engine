import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';

const execFileAsync = promisify(execFile);

export interface RunPayload {
  formatted: string;
  savings: {
    rawTokens: number;
    optimizedTokens: number;
    savedTokens: number;
    reductionPercent: number;
    reductionMultiple: number;
  };
  manifest: ManifestItem[];
}

export interface ManifestItem {
  relativePath: string;
  compressionLevel: 'full' | 'symbols' | 'summary' | 'excluded';
  tokenCount: number;
  reason: string;
}

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
  payload?: RunPayload;
}

export class DeltaRunner {
  private watchProcess: ChildProcess | null = null;
  private deltaPath: string;
  private nodePath: string;

  constructor(private workspaceRoot: string) {
    this.deltaPath = this.findDeltaCli(workspaceRoot);
    this.nodePath = this.findNode();
    if (!this.deltaPath) {
      console.error('∆ Delta: Could not find delta CLI');
    }
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
        this.workspaceRoot = current;
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

  async init(): Promise<CommandResult> {
    if (!this.deltaPath) {
      return {
        success: false,
        error: 'Delta CLI not found. Run: npx tsc in project root',
      };
    }
    try {
      const { stdout } = await execFileAsync(
        this.nodePath,
        [this.deltaPath, 'init', '--root', this.workspaceRoot],
        { cwd: this.workspaceRoot, timeout: 120_000 }
      );
      return { success: true, output: stdout.trim() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async run(task: string, budget = 2000): Promise<CommandResult> {
    if (!this.deltaPath) {
      return {
        success: false,
        error: 'Delta CLI not found. Run: npx tsc in project root',
      };
    }
    try {
      const { stdout } = await execFileAsync(
        this.nodePath,
        [
          this.deltaPath,
          'run',
          task,
          '--budget', String(budget),
          '--root', this.workspaceRoot,
        ],
        { cwd: this.workspaceRoot, timeout: 60_000 }
      );
      const payload = parseRunOutput(stdout);
      return { success: true, output: stdout, payload };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async stats(): Promise<CommandResult> {
    if (!this.deltaPath) {
      return { success: false, error: 'Delta CLI not found.' };
    }
    try {
      const { stdout } = await execFileAsync(
        this.nodePath,
        [this.deltaPath, 'stats', '--root', this.workspaceRoot],
        { cwd: this.workspaceRoot, timeout: 30_000 }
      );
      return { success: true, output: stdout.trim() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async startWatch(): Promise<CommandResult> {
    if (this.watchProcess) {
      return { success: true, output: 'Already watching' };
    }
    try {
      this.watchProcess = spawn(
        this.nodePath,
        [this.deltaPath, 'watch', '--root', this.workspaceRoot],
        { cwd: this.workspaceRoot, detached: false, stdio: 'pipe' }
      );
      this.watchProcess.on('exit', () => {
        this.watchProcess = null;
      });
      return { success: true, output: 'Watch mode started' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  stopWatch(): void {
    if (this.watchProcess) {
      this.watchProcess.kill('SIGINT');
      this.watchProcess = null;
    }
  }

  isWatching(): boolean {
    return this.watchProcess !== null;
  }
}

function parseRunOutput(output: string): RunPayload {
  const beforeMatch = output.match(/Before:\s+[█░]+\s+([\d,]+)/);
  const afterMatch  = output.match(/After:\s+[█░]+\s+([\d,]+)/);
  const savedMatch  = output.match(/Saved:\s+([\d,]+) tokens.*?(\d+)% reduction.*?([\d.]+)×/);

  const rawTokens       = parseInt((beforeMatch?.[1] ?? '0').replace(/,/g, ''), 10);
  const optimizedTokens = parseInt((afterMatch?.[1]  ?? '0').replace(/,/g, ''), 10);
  const savedTokens     = parseInt((savedMatch?.[1]  ?? '0').replace(/,/g, ''), 10);
  const reductionPct    = parseInt(savedMatch?.[2]   ?? '0', 10);
  const reductionMult   = parseFloat(savedMatch?.[3] ?? '1');

  const manifest: ManifestItem[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(
      /\s+([✅○·✗])\s+(\S+)\s+\((full|symbols|summary|excluded)\)/
    );
    if (match) {
      const icon = match[1];
      manifest.push({
        relativePath: match[2] ?? '',
        compressionLevel:
          (match[3] as ManifestItem['compressionLevel']) ?? 'excluded',
        tokenCount: 0,
        reason:
          icon === '✅' ? 'CHANGED' :
          icon === '○'  ? 'TOUCHED' :
          icon === '·'  ? 'ANCESTOR' : 'EXCLUDED',
      });
    }
  }

  return {
    formatted: output,
    savings: {
      rawTokens,
      optimizedTokens,
      savedTokens,
      reductionPercent: reductionPct,
      reductionMultiple: reductionMult,
    },
    manifest,
  };
}