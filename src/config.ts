import { ConfigError } from "./errors.js";

/** Runtime configuration, resolved once at startup from environment variables. */
export interface Config {
  /** Navigation timeout for the headless browser, in milliseconds. */
  navTimeoutMs: number;
  /** Timeout for the plain HTTP fetch used by traditional extraction. */
  fetchTimeoutMs: number;
  /** Minimum characters of extracted text before the traditional path is deemed sufficient. */
  minTextLength: number;
  /** Maximum bytes read from a traditional HTTP response (memory-exhaustion guard). */
  maxResponseBytes: number;
  /** User-Agent sent by both the HTTP fetch and the headless browser. */
  userAgent: string;
  /** Run Chromium headless (default) or headed (for debugging). */
  headless: boolean;
  /** Browser width, and the tile height used when not capturing the full page. */
  viewport: { width: number; height: number };
  /** Height of each screenshot tile for full-page captures. */
  tileHeight: number;
  /** Vertical overlap between consecutive tiles, to avoid cutting text lines. */
  tileOverlap: number;
  /** Maximum number of tiles captured for a single page. */
  maxTiles: number;
  /** Allow access to private / loopback hosts (off by default for SSRF safety). */
  allowPrivateHosts: boolean;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; pixel-scraper/0.2; +https://github.com/robertkiewisz/pixel-scraper)";

function num(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  // Integer-only: these are milliseconds, byte counts, character counts, pixel
  // dimensions, and tile counts — a fractional viewport/tile size would make
  // Playwright reject the browser context. Number.isInteger also rejects NaN and
  // Infinity, so it subsumes the finiteness check.
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ConfigError(
      `Environment variable ${name} must be an integer >= ${min}, got "${raw}".`,
    );
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function loadConfig(): Config {
  return {
    navTimeoutMs: num("PIXEL_SCRAPER_NAV_TIMEOUT_MS", 30_000, 1),
    fetchTimeoutMs: num("PIXEL_SCRAPER_FETCH_TIMEOUT_MS", 15_000, 1),
    minTextLength: num("PIXEL_SCRAPER_MIN_TEXT_LENGTH", 200),
    maxResponseBytes: num("PIXEL_SCRAPER_MAX_RESPONSE_BYTES", 8_000_000, 1),
    userAgent: process.env.PIXEL_SCRAPER_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    headless: bool("PIXEL_SCRAPER_HEADLESS", true),
    viewport: {
      width: num("PIXEL_SCRAPER_VIEWPORT_WIDTH", 1280, 1),
      height: num("PIXEL_SCRAPER_VIEWPORT_HEIGHT", 1024, 1),
    },
    tileHeight: num("PIXEL_SCRAPER_TILE_HEIGHT", 1400, 1),
    tileOverlap: num("PIXEL_SCRAPER_TILE_OVERLAP", 100),
    maxTiles: num("PIXEL_SCRAPER_MAX_TILES", 8, 1),
    allowPrivateHosts: bool("PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS", false),
  };
}
