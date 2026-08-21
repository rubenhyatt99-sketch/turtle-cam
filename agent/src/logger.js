/** Journalisation minimale, horodatée, lisible dans journalctl. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = "info") {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (name, stream) => (message) => {
    if (LEVELS[name] < min) return;
    stream(`${new Date().toISOString()} [${name.toUpperCase()}] ${message}`);
  };
  return {
    debug: write("debug", console.log),
    info: write("info", console.log),
    warn: write("warn", console.warn),
    error: write("error", console.error),
  };
}
