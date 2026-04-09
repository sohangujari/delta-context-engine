import fs from 'fs';
import path from 'path';
import { CONFIG_FILE, DEFAULT_CONFIG } from './defaults.js';

export type DeltaConfig = typeof DEFAULT_CONFIG;

export function loadConfig(projectRoot: string): DeltaConfig {
  const configPath = path.join(projectRoot, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DeltaConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    console.warn('⚠ Could not parse .delta/config.json — using defaults');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(projectRoot: string, config: DeltaConfig): void {
  const configPath = path.join(projectRoot, CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal !== undefined &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null
    ) {
      result[key] = deepMerge(
        baseVal as object,
        overrideVal as object
      ) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}