/**
 * `delta proxy` — OpenAI-compatible proxy that auto-injects Delta context.
 *
 * Sits between your AI tool and the LLM provider.
 * Intercepts requests, injects optimized context from Delta,
 * then forwards to the configured provider.
 *
 * Supports: OpenAI, Anthropic, Gemini, local LLMs (any OpenAI-compatible API).
 */

import chalk from 'chalk';
import path from 'path';
import http from 'http';
import { initializeDatabase } from '../../../persistence/database.js';
import { handleGetOptimizedContext } from '../../claude-code/tool-handlers.js';

export interface ProxyOptions {
  root: string;
  port?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
}

interface ProviderConfig {
  name: string;
  baseUrl: string;
  headerKey: string;
  model: string;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    headerKey: 'Authorization',
    model: 'gpt-4o',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    headerKey: 'x-api-key',
    model: 'claude-sonnet-4-20250514',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    headerKey: 'x-goog-api-key',
    model: 'gemini-2.5-flash',
  },
  local: {
    name: 'Local LLM',
    baseUrl: 'http://localhost:11434',
    headerKey: 'Authorization',
    model: 'llama3',
  },
};

export async function proxyCommand(options: ProxyOptions): Promise<void> {
  const root = path.resolve(options.root);
  const port = parseInt(options.port ?? '7735', 10);
  const providerName = options.provider ?? 'openai';
  const providerConfig = PROVIDERS[providerName] ?? PROVIDERS['openai']!;
  const model = options.model ?? providerConfig.model;
  const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'] ?? '';

  await initializeDatabase();

  console.log(chalk.bold('\n∆ Delta Context Proxy'));
  console.log(chalk.dim('─'.repeat(45)));

  const proxyServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        proxy: 'delta-context-proxy',
        provider: providerConfig.name,
        model,
      }));
      return;
    }

    // Only intercept chat completions
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const requestBody = JSON.parse(body);
      const messages = requestBody.messages ?? [];

      // Extract the last user message as the "task"
      const lastUserMsg = [...messages].reverse().find(
        (m: { role: string }) => m.role === 'user'
      );
      const task = lastUserMsg?.content ?? '';

      // Get Delta context for this task
      const contextResult = await handleGetOptimizedContext(
        { task, projectRoot: root },
        root
      );

      const deltaContext = contextResult.content[0]?.text ?? '';

      // Inject context as a system message
      if (deltaContext && !contextResult.isError) {
        const contextMessage = {
          role: 'system',
          content: `[Delta Context Engine — Auto-injected optimized context]\n\n${deltaContext}`,
        };

        // Insert after any existing system messages
        const systemEnd = messages.findIndex(
          (m: { role: string }) => m.role !== 'system'
        );
        if (systemEnd === -1) {
          messages.push(contextMessage);
        } else {
          messages.splice(systemEnd, 0, contextMessage);
        }
        requestBody.messages = messages;
      }

      // Override model if specified
      if (model) {
        requestBody.model = model;
      }

      // Forward to provider
      const targetUrl = new URL(req.url ?? '/v1/chat/completions', providerConfig.baseUrl);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        if (providerConfig.headerKey === 'Authorization') {
          headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
        } else {
          headers[providerConfig.headerKey] = apiKey;
        }
      }

      const response = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      const responseBody = await response.text();

      res.writeHead(response.status, {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      });
      res.end(responseBody);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: err instanceof Error ? err.message : String(err) },
      }));
    }
  });

  proxyServer.listen(port, '127.0.0.1', () => {
    console.log(chalk.green(`\n✓ Proxy running on http://127.0.0.1:${port}`));
    console.log(chalk.dim(`  Provider: ${providerConfig.name} (${model})`));
    console.log(chalk.dim(`  Project root: ${root}`));
    console.log('');
    console.log(chalk.bold('Usage:'));
    console.log(chalk.cyan(`  export OPENAI_API_BASE=http://127.0.0.1:${port}/v1`));
    console.log(chalk.dim('  Then use any OpenAI-compatible tool as normal.'));
    console.log(chalk.dim('  Delta context will be auto-injected into every request.'));
    console.log(chalk.dim('\nPress Ctrl+C to stop.\n'));
  });

  process.on('SIGINT', () => {
    console.log(chalk.dim('\nShutting down proxy...'));
    proxyServer.close();
    process.exit(0);
  });
}
