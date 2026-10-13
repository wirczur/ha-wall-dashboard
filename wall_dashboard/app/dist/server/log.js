import fs from 'node:fs';
const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
function configuredLevel() {
    try {
        const opts = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
        if (opts.log_level in LEVELS)
            return opts.log_level;
    }
    catch { /* outside HA */ }
    const env = process.env.LOG_LEVEL;
    return env && env in LEVELS ? env : 'info';
}
const min = LEVELS[configuredLevel()];
function out(level, args) {
    if (LEVELS[level] < min)
        return;
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    (level === 'error' ? console.error : console.log)(`[${ts}] ${level.toUpperCase()}`, ...args);
}
export const log = {
    debug: (...a) => out('debug', a),
    info: (...a) => out('info', a),
    warn: (...a) => out('warning', a),
    error: (...a) => out('error', a)
};
