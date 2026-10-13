import fs from 'node:fs';

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function configuredLevel(): Level {
  try {
    const opts = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    if (opts.log_level in LEVELS) return opts.log_level;
  } catch { /* outside HA */ }
  const env = process.env.LOG_LEVEL as Level | undefined;
  return env && env in LEVELS ? env : 'info';
}

const min = LEVELS[configuredLevel()];
function out(level: Level, args: unknown[]) {
  if (LEVELS[level] < min) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  (level === 'error' ? console.error : console.log)(`[${ts}] ${level.toUpperCase()}`, ...args);
}

export const log = {
  debug: (...a: unknown[]) => out('debug', a),
  info: (...a: unknown[]) => out('info', a),
  warn: (...a: unknown[]) => out('warning', a),
  error: (...a: unknown[]) => out('error', a)
};
