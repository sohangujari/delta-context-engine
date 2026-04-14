import { encodingForModel } from 'js-tiktoken';

// cl100k_base is the encoding Claude uses
// We load it once and reuse
let encoding: ReturnType<typeof encodingForModel> | null = null;

function getEncoding(): ReturnType<typeof encodingForModel> {
  if (!encoding) {
    encoding = encodingForModel('gpt-4');  // cl100k_base — same as Claude
  }
  return encoding;
}

export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  try {
    const enc = getEncoding();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch {
    // Fallback: rough approximation (4 chars per token)
    return Math.ceil(text.length / 4);
  }
}

export function countTokensForFiles(
  files: Array<{ content: string }>
): number {
  return files.reduce((sum, f) => sum + countTokens(f.content), 0);
}

export function estimateTokens(text: string): number {
  // Fast approximation without encoding — use for non-critical estimates
  return Math.ceil(text.length / 4);
}// touch
