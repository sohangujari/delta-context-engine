import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { DeltaDb } from '../../../persistence/delta-db.js';
import {
  MemoryStore,
  type MemoryItem,
  type MemoryType,
  type MemoryConfidence,
} from '../../../persistence/memory-store.js';

// ── Sub-command router ────────────────────────────────────────────────────────

const MEMORY_TYPES: MemoryType[] = [
  'ARCHITECTURAL',
  'DECISION',
  'BUG',
  'FLOW',
  'EDGE_CASE',
  'COMMUNITY',
];

const MEMORY_CONFIDENCES: MemoryConfidence[] = ['HIGH', 'MEDIUM', 'LOW', 'STALE'];

export async function memoryCommand(
  subcommand: string,
  args: string[],
  options: { root: string }
): Promise<void> {
  const root = path.resolve(options.root);

  switch (subcommand) {
    case 'list':
      return memoryList(root, args);
    case 'show':
      return memoryShow(root, args);
    case 'add':
      return memoryAdd(root, args);
    case 'forget':
      return memoryForget(root, args);
    case 'search':
      return memorySearch(root, args);
    case 'export':
      return memoryExport(root);
    case 'import':
      return memoryImport(root, args);
    case 'stats':
      return memoryStats(root);
    case 'confirm':
      return memoryConfirm(root, args);
    default:
      console.log(chalk.red(`Unknown memory sub-command: ${subcommand}`));
      console.log('');
      printMemoryHelp();
      break;
  }
}

function printMemoryHelp(): void {
  console.log(chalk.bold('∆ Delta Memory'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log('');
  console.log('Usage: delta memory <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log(`  ${chalk.cyan('list')}                       List all stored memories`);
  console.log(`  ${chalk.cyan('list --type FLOW')}           Filter by type`);
  console.log(`  ${chalk.cyan('list --confidence HIGH')}     Filter by confidence`);
  console.log(`  ${chalk.cyan('show <id>')}                  Show full memory content`);
  console.log(`  ${chalk.cyan('add <title>')}                Interactively add a memory`);
  console.log(`  ${chalk.cyan('forget <id>')}                Delete a memory`);
  console.log(`  ${chalk.cyan('search <query>')}             Search memories by text`);
  console.log(`  ${chalk.cyan('export')}                     Export all memories as Markdown`);
  console.log(`  ${chalk.cyan('import <file>')}              Import memories from Markdown`);
  console.log(`  ${chalk.cyan('stats')}                      Show memory statistics`);
  console.log(`  ${chalk.cyan('confirm <id>')}               Confirm a stale memory`);
  console.log('');
}

// ── delta memory list ─────────────────────────────────────────────────────────

async function memoryList(root: string, args: string[]): Promise<void> {
  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    // Parse inline flags from args
    const filters: { type?: MemoryType; confidence?: MemoryConfidence } = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const next = args[i + 1];
      if (arg === '--type' && next) {
        const upper = next.toUpperCase();
        if (MEMORY_TYPES.includes(upper as MemoryType)) {
          filters.type = upper as MemoryType;
        }
        i++;
      }
      if (arg === '--confidence' && next) {
        const upper = next.toUpperCase();
        if (MEMORY_CONFIDENCES.includes(upper as MemoryConfidence)) {
          filters.confidence = upper as MemoryConfidence;
        }
        i++;
      }
    }

    const memories = store.list(filters);

    console.log(chalk.bold('\n∆ Delta Memory'));
    console.log(chalk.dim('─'.repeat(54)));

    if (memories.length === 0) {
      console.log(chalk.dim('No memories stored.'));
      console.log(chalk.dim('Run: delta memory add <title>'));
      return;
    }

    // Header
    console.log(
      chalk.dim(
        'Type'.padEnd(14) +
          'Confidence'.padEnd(12) +
          'Topic'.padEnd(25) +
          'Title'
      )
    );

    for (const m of memories) {
      const typeStr = formatType(m.type).padEnd(14);
      const confStr = formatConfidence(m.confidence).padEnd(12);
      const topicStr = m.topic.padEnd(25);
      const titleStr = m.title.length > 35 ? m.title.slice(0, 32) + '...' : m.title;

      console.log(`${typeStr}${confStr}${topicStr}${titleStr}`);
    }

    console.log(chalk.dim('─'.repeat(54)));
    console.log(
      chalk.dim(
        `${memories.length} memor${memories.length === 1 ? 'y' : 'ies'} stored · Run: delta memory show <id>`
      )
    );
  } finally {
    db.close();
  }
}

// ── delta memory show <id> ────────────────────────────────────────────────────

async function memoryShow(root: string, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.log(chalk.red('Usage: delta memory show <id>'));
    return;
  }

  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    const memory = store.get(id);
    if (!memory) {
      // Try partial ID match
      const all = store.getAll();
      const matches = all.filter((m) => m.id.startsWith(id));
      if (matches.length === 1 && matches[0]) {
        printMemoryDetail(matches[0]);
        return;
      }
      if (matches.length > 1) {
        console.log(chalk.yellow(`Multiple memories match "${id}":`));
        for (const m of matches) {
          console.log(`  ${m.id}  ${m.title}`);
        }
        return;
      }
      console.log(chalk.red(`Memory not found: ${id}`));
      return;
    }

    printMemoryDetail(memory);
  } finally {
    db.close();
  }
}

function printMemoryDetail(m: MemoryItem): void {
  console.log(chalk.bold(`\n∆ Memory: ${m.title}`));
  console.log(chalk.dim('─'.repeat(54)));
  console.log(`${chalk.dim('ID:')}          ${m.id}`);
  console.log(`${chalk.dim('Type:')}        ${formatType(m.type)}`);
  console.log(`${chalk.dim('Topic:')}       ${m.topic}`);
  console.log(`${chalk.dim('Confidence:')}  ${formatConfidence(m.confidence)}`);
  console.log(`${chalk.dim('Source:')}      ${m.source}`);
  console.log(`${chalk.dim('Created:')}     ${m.createdAt.split('T')[0]}`);
  console.log(`${chalk.dim('Updated:')}     ${m.updatedAt.split('T')[0]}`);

  if (m.filePaths.length > 0) {
    console.log(`${chalk.dim('Files:')}       ${m.filePaths.join(', ')}`);
  }

  console.log('');
  console.log(chalk.dim('Content:'));
  console.log(chalk.dim('─'.repeat(54)));
  console.log(m.content);
  console.log(chalk.dim('─'.repeat(54)));

  if (m.tags.length > 0) {
    console.log(`${chalk.dim('Tags:')} ${m.tags.join(', ')}`);
  }
}

// ── delta memory add <title> ──────────────────────────────────────────────────

async function memoryAdd(root: string, args: string[]): Promise<void> {
  const titleArg = args.join(' ').trim();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });

  try {
    console.log(chalk.bold('\n∆ Add Memory'));
    console.log(chalk.dim('─'.repeat(54)));

    // 1. Title
    let title = titleArg;
    if (!title) {
      title = await ask(chalk.cyan('Title: '));
      if (!title) {
        console.log(chalk.red('Title is required.'));
        return;
      }
    } else {
      console.log(chalk.cyan(`Title: ${title}`));
    }

    // 2. Type
    console.log(chalk.dim(`Types: ${MEMORY_TYPES.join(', ')}`));
    const typeInput = await ask(chalk.cyan('Type: '));
    const type = typeInput.toUpperCase();
    if (!MEMORY_TYPES.includes(type as MemoryType)) {
      console.log(chalk.red(`Invalid type. Choose from: ${MEMORY_TYPES.join(', ')}`));
      return;
    }

    // 3. Topic
    const topic = await ask(chalk.cyan('Topic (e.g. auth/flow): '));
    if (!topic) {
      console.log(chalk.red('Topic is required.'));
      return;
    }

    // 4. Content (multi-line)
    console.log(chalk.dim('Content (enter an empty line to finish):'));
    const contentLines: string[] = [];
    let line = await ask('');
    while (line !== '') {
      contentLines.push(line);
      line = await ask('');
    }
    const content = contentLines.join('\n');
    if (!content) {
      console.log(chalk.red('Content is required.'));
      return;
    }

    // 5. Related files
    const filesInput = await ask(chalk.cyan('Related files (comma-separated, optional): '));
    const filePaths = filesInput
      ? filesInput.split(',').map((f) => f.trim()).filter(Boolean)
      : [];

    // 6. Tags
    const tagsInput = await ask(chalk.cyan('Tags (comma-separated, optional): '));
    const tags = tagsInput
      ? tagsInput.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    // Save
    const now = new Date().toISOString();
    const item: MemoryItem = {
      id: MemoryStore.generateId(),
      topic,
      type: type as MemoryType,
      title,
      content,
      confidence: 'MEDIUM',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      lastAccessed: now,
      filePaths,
      tags,
    };

    const db = new DeltaDb(root);
    const store = new MemoryStore(db.getDb());

    try {
      store.save(item);
      console.log('');
      console.log(chalk.green(`✔ Memory saved: ${item.id}`));
      console.log(chalk.dim(`  Topic: ${topic} · Type: ${type}`));
    } finally {
      db.close();
    }
  } finally {
    rl.close();
  }
}

// ── delta memory forget <id> ──────────────────────────────────────────────────

async function memoryForget(root: string, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.log(chalk.red('Usage: delta memory forget <id>'));
    return;
  }

  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    // Try partial match
    let targetId = id;
    const existing = store.get(id);
    if (!existing) {
      const all = store.getAll();
      const matches = all.filter((m) => m.id.startsWith(id));
      if (matches.length === 1 && matches[0]) {
        targetId = matches[0].id;
      } else if (matches.length > 1) {
        console.log(chalk.yellow(`Multiple memories match "${id}":`));
        for (const m of matches) {
          console.log(`  ${m.id}  ${m.title}`);
        }
        return;
      } else {
        console.log(chalk.red(`Memory not found: ${id}`));
        return;
      }
    }

    const deleted = store.delete(targetId);
    if (deleted) {
      console.log(chalk.green(`✔ Memory deleted: ${targetId}`));
    } else {
      console.log(chalk.red(`Memory not found: ${targetId}`));
    }
  } finally {
    db.close();
  }
}

// ── delta memory search <query> ───────────────────────────────────────────────

async function memorySearch(root: string, args: string[]): Promise<void> {
  const query = args.join(' ').trim();
  if (!query) {
    console.log(chalk.red('Usage: delta memory search <query>'));
    return;
  }

  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    const results = store.search(query);

    console.log(chalk.bold(`\n∆ Memory Search: "${query}"`));
    console.log(chalk.dim('─'.repeat(54)));

    if (results.length === 0) {
      console.log(chalk.dim('No memories match your search.'));
      return;
    }

    for (const m of results) {
      const confStr = formatConfidence(m.confidence);
      console.log(
        `  ${chalk.cyan(m.id.slice(0, 8))}  ${formatType(m.type).padEnd(14)} ${confStr.padEnd(10)} ${m.title}`
      );
    }

    console.log(chalk.dim(`\n${results.length} result(s) · Run: delta memory show <id>`));
  } finally {
    db.close();
  }
}

// ── delta memory export ───────────────────────────────────────────────────────

async function memoryExport(root: string): Promise<void> {
  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    const memories = store.getAll();

    if (memories.length === 0) {
      console.log(chalk.dim('No memories to export.'));
      return;
    }

    const lines: string[] = [];
    lines.push('# Delta Memory Export');
    lines.push(`<!-- Exported: ${new Date().toISOString()} -->`);
    lines.push(`<!-- Count: ${memories.length} -->`);
    lines.push('');

    for (const m of memories) {
      lines.push(`## ${m.title}`);
      lines.push('');
      lines.push(`- **ID:** ${m.id}`);
      lines.push(`- **Type:** ${m.type}`);
      lines.push(`- **Topic:** ${m.topic}`);
      lines.push(`- **Confidence:** ${m.confidence}`);
      lines.push(`- **Source:** ${m.source}`);
      lines.push(`- **Created:** ${m.createdAt}`);
      lines.push(`- **Updated:** ${m.updatedAt}`);

      if (m.filePaths.length > 0) {
        lines.push(`- **Files:** ${m.filePaths.join(', ')}`);
      }
      if (m.tags.length > 0) {
        lines.push(`- **Tags:** ${m.tags.join(', ')}`);
      }

      lines.push('');
      lines.push('```');
      lines.push(m.content);
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    const exportPath = path.join(root, '.delta', 'memory-export.md');
    fs.writeFileSync(exportPath, lines.join('\n'), 'utf-8');

    console.log(chalk.green(`✔ Exported ${memories.length} memories → ${exportPath}`));
  } finally {
    db.close();
  }
}

// ── delta memory import <file> ────────────────────────────────────────────────

async function memoryImport(root: string, args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.log(chalk.red('Usage: delta memory import <file>'));
    return;
  }

  const resolvedPath = path.resolve(root, filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.log(chalk.red(`File not found: ${resolvedPath}`));
    return;
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const memories = parseMemoryMarkdown(content);

  if (memories.length === 0) {
    console.log(chalk.yellow('No memories found in file.'));
    return;
  }

  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    let imported = 0;
    for (const m of memories) {
      store.save(m);
      imported++;
    }

    console.log(chalk.green(`✔ Imported ${imported} memories from ${filePath}`));
  } finally {
    db.close();
  }
}

/**
 * Parse a Delta memory export Markdown file back into MemoryItems.
 * Expects the format produced by `delta memory export`.
 */
function parseMemoryMarkdown(content: string): MemoryItem[] {
  const memories: MemoryItem[] = [];
  const sections = content.split(/^## /m).slice(1); // split on ## headings

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0]?.trim() ?? '';
    if (!title) continue;

    const now = new Date().toISOString();
    const item: MemoryItem = {
      id: MemoryStore.generateId(),
      topic: 'general',
      type: 'ARCHITECTURAL',
      title,
      content: '',
      confidence: 'MEDIUM',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      lastAccessed: now,
      filePaths: [],
      tags: [],
    };

    let inContent = false;
    const contentLines: string[] = [];

    for (const line of lines.slice(1)) {
      // Parse metadata lines
      const idMatch = line.match(/^\s*-\s*\*\*ID:\*\*\s*(.+)/);
      if (idMatch?.[1]) {
        item.id = idMatch[1].trim();
        continue;
      }

      const typeMatch = line.match(/^\s*-\s*\*\*Type:\*\*\s*(.+)/);
      if (typeMatch?.[1]) {
        const t = typeMatch[1].trim().toUpperCase();
        if (MEMORY_TYPES.includes(t as MemoryType)) {
          item.type = t as MemoryType;
        }
        continue;
      }

      const topicMatch = line.match(/^\s*-\s*\*\*Topic:\*\*\s*(.+)/);
      if (topicMatch?.[1]) {
        item.topic = topicMatch[1].trim();
        continue;
      }

      const confMatch = line.match(/^\s*-\s*\*\*Confidence:\*\*\s*(.+)/);
      if (confMatch?.[1]) {
        const c = confMatch[1].trim().toUpperCase();
        if (MEMORY_CONFIDENCES.includes(c as MemoryConfidence)) {
          item.confidence = c as MemoryConfidence;
        }
        continue;
      }

      const sourceMatch = line.match(/^\s*-\s*\*\*Source:\*\*\s*(.+)/);
      if (sourceMatch?.[1]) {
        const s = sourceMatch[1].trim();
        if (s === 'auto' || s === 'manual') {
          item.source = s;
        }
        continue;
      }

      const createdMatch = line.match(/^\s*-\s*\*\*Created:\*\*\s*(.+)/);
      if (createdMatch?.[1]) {
        item.createdAt = createdMatch[1].trim();
        continue;
      }

      const updatedMatch = line.match(/^\s*-\s*\*\*Updated:\*\*\s*(.+)/);
      if (updatedMatch?.[1]) {
        item.updatedAt = updatedMatch[1].trim();
        continue;
      }

      const filesMatch = line.match(/^\s*-\s*\*\*Files:\*\*\s*(.+)/);
      if (filesMatch?.[1]) {
        item.filePaths = filesMatch[1].split(',').map((f) => f.trim()).filter(Boolean);
        continue;
      }

      const tagsMatch = line.match(/^\s*-\s*\*\*Tags:\*\*\s*(.+)/);
      if (tagsMatch?.[1]) {
        item.tags = tagsMatch[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        continue;
      }

      // Content block detection
      if (line.trim() === '```' && !inContent) {
        inContent = true;
        continue;
      }
      if (line.trim() === '```' && inContent) {
        inContent = false;
        continue;
      }
      if (inContent) {
        contentLines.push(line);
      }
    }

    item.content = contentLines.join('\n').trim();
    if (item.content) {
      memories.push(item);
    }
  }

  return memories;
}

// ── delta memory stats ────────────────────────────────────────────────────────

async function memoryStats(root: string): Promise<void> {
  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    const stats = store.getStats();

    console.log(chalk.bold('\n∆ Memory Statistics'));
    console.log(chalk.dim('─'.repeat(54)));
    console.log(`Total memories:     ${chalk.cyan(stats.total.toString())}`);
    console.log('By type:');
    for (const type of MEMORY_TYPES) {
      const count = stats.byType[type];
      const countStr = count > 0 ? chalk.cyan(count.toString()) : chalk.dim('0');
      console.log(`  ${type.padEnd(18)} ${countStr}`);
    }
    console.log('By confidence:');
    for (const conf of MEMORY_CONFIDENCES) {
      const count = stats.byConfidence[conf];
      const countStr = count > 0 ? chalk.cyan(count.toString()) : chalk.dim('0');
      console.log(`  ${conf.padEnd(18)} ${countStr}`);
    }
    console.log(`Linked files:       ${chalk.cyan(stats.linkedFiles.toString())} unique files`);
    console.log(chalk.dim('─'.repeat(54)));
  } finally {
    db.close();
  }
}

// ── delta memory confirm <id> ─────────────────────────────────────────────────

async function memoryConfirm(root: string, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.log(chalk.red('Usage: delta memory confirm <id>'));
    return;
  }

  const db = new DeltaDb(root);
  const store = new MemoryStore(db.getDb());

  try {
    // Try partial match
    let memory = store.get(id);
    if (!memory) {
      const all = store.getAll();
      const matches = all.filter((m) => m.id.startsWith(id));
      if (matches.length === 1 && matches[0]) {
        memory = store.get(matches[0].id);
      } else if (matches.length > 1) {
        console.log(chalk.yellow(`Multiple memories match "${id}":`));
        for (const m of matches) {
          console.log(`  ${m.id}  ${m.title}`);
        }
        return;
      }
    }

    if (!memory) {
      console.log(chalk.red(`Memory not found: ${id}`));
      return;
    }

    if (memory.confidence !== 'STALE') {
      console.log(chalk.dim(`Memory "${memory.title}" is not stale (confidence: ${memory.confidence}).`));
      return;
    }

    // Show content for review
    console.log(chalk.bold(`\n∆ Confirm Memory: ${memory.title}`));
    console.log(chalk.dim('─'.repeat(54)));
    console.log(memory.content);
    console.log(chalk.dim('─'.repeat(54)));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.cyan('Is this still accurate? [y/n]: '),
        (a) => resolve(a.trim().toLowerCase())
      );
    });
    rl.close();

    if (answer === 'y' || answer === 'yes') {
      store.updateConfidence(memory.id, 'MEDIUM');
      console.log(chalk.green(`✔ Memory confirmed — confidence restored to MEDIUM`));
    } else {
      console.log(chalk.dim('Memory remains STALE. Use "delta memory forget" to delete or "delta memory show" to review.'));
    }
  } finally {
    db.close();
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatType(type: MemoryType): string {
  const colors: Record<MemoryType, (s: string) => string> = {
    ARCHITECTURAL: chalk.magenta,
    DECISION: chalk.blue,
    BUG: chalk.red,
    FLOW: chalk.green,
    EDGE_CASE: chalk.yellow,
    COMMUNITY: chalk.cyan,
  };
  return (colors[type] ?? chalk.white)(type);
}

function formatConfidence(confidence: MemoryConfidence): string {
  const colors: Record<MemoryConfidence, (s: string) => string> = {
    HIGH: chalk.green,
    MEDIUM: chalk.yellow,
    LOW: chalk.dim,
    STALE: chalk.red,
  };
  return (colors[confidence] ?? chalk.white)(confidence);
}
