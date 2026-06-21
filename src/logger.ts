/**
 * Minimal stderr logger.
 *
 * An MCP stdio server speaks the protocol over stdout, so every diagnostic
 * MUST go to stderr — writing logs to stdout corrupts the JSON-RPC stream.
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveThreshold(): Level {
  const raw = process.env.PIXEL_SCRAPER_LOG_LEVEL?.trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

const THRESHOLD = resolveThreshold();

function write(level: Level, message: string): void {
  if (ORDER[level] < ORDER[THRESHOLD]) return;
  process.stderr.write(
    `[pixel-scraper] ${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`,
  );
}

export const logger = {
  debug: (message: string) => write("debug", message),
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};
