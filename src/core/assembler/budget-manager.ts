import type { DeltaConfig } from '../../config/delta.config.js';

export interface EscalationResult {
  originalBudget: number;
  finalBudget: number;
  escalated: boolean;
  reason: string;
}

/**
 * Auto-escalate the token budget based on how many files changed.
 *
 * Rules (from PRD OQ-6):
 *   < 5 changed files  → keep configured budget (no escalation)
 *   ≥ 5 changed files  → conservative → balanced (2k → 4k)
 *   ≥ 10 changed files → balanced → thorough (4k → 8k)
 *
 * Can be disabled via config: budget.autoEscalate = false
 */
export function autoEscalateBudget(
  changedFileCount: number,
  configuredBudget: number,
  config: DeltaConfig
): EscalationResult {
  // Check if auto-escalation is disabled
  // We read from config - default is enabled
  const autoEscalate =
    (config as unknown as { budget: { autoEscalate?: boolean } })
      .budget?.autoEscalate ?? true;

  if (!autoEscalate) {
    return {
      originalBudget: configuredBudget,
      finalBudget: configuredBudget,
      escalated: false,
      reason: 'auto-escalation disabled in config',
    };
  }

  // No escalation needed
  if (changedFileCount < 5) {
    return {
      originalBudget: configuredBudget,
      finalBudget: configuredBudget,
      escalated: false,
      reason: `${changedFileCount} file(s) changed - within normal range`,
    };
  }

  // Large refactor: ≥10 files → thorough (8k)
  if (changedFileCount >= 10) {
    const finalBudget = Math.max(configuredBudget, 8000);
    const escalated = finalBudget > configuredBudget;
    return {
      originalBudget: configuredBudget,
      finalBudget,
      escalated,
      reason: `large refactor detected (${changedFileCount} files changed) → thorough budget`,
    };
  }

  // Medium refactor: 5–9 files → balanced (4k)
  const finalBudget = Math.max(configuredBudget, 4000);
  const escalated = finalBudget > configuredBudget;
  return {
    originalBudget: configuredBudget,
    finalBudget,
    escalated,
    reason: `multi-file change detected (${changedFileCount} files) → balanced budget`,
  };
}

/**
 * Format the escalation notice for terminal display.
 */
export function formatEscalationNotice(result: EscalationResult): string {
  if (!result.escalated) return '';

  return [
    `∆ Budget auto-escalated: ${result.originalBudget.toLocaleString()} → ${result.finalBudget.toLocaleString()} tokens`,
    `  Reason: ${result.reason}`,
    `  Override: delta run --budget ${result.originalBudget} --no-escalate`,
  ].join('\n');
}