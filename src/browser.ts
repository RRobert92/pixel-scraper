import { type Browser, chromium } from "playwright";

import type { Config } from "./config.js";
import { BlockedHostError, BrowserError, PixelScraperError } from "./errors.js";
import { logger } from "./logger.js";
import { isPrivateHost } from "./url.js";
import { errMsg } from "./util.js";

// A single shared browser instance, launched lazily on first use.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(config: Config): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: config.headless }).catch((err: unknown) => {
      browserPromise = null;
      throw new BrowserError(
        `Failed to launch Chromium. Did you run "npx playwright install chromium"? ` +
          `Original error: ${errMsg(err)}`,
      );
    });
  }
  return browserPromise;
}

/** One screenshot tile: a base64 PNG plus its position in the sequence. */
export interface Tile {
  base64: string;
  index: number;
  total: number;
  width: number;
  height: number;
}

export interface TilesResult {
  tiles: Tile[];
  finalUrl: string;
  pageWidth: number;
  pageHeight: number;
  /** True when the page was taller than `maxTiles` could cover. */
  truncated: boolean;
  /** False when navigation fell back to `domcontentloaded` (network never went idle). */
  fullyLoaded: boolean;
}

/**
 * Render a page and capture it as one or more screenshot tiles.
 *
 * For tall pages, the capture is sliced into bounded vertical tiles (with a
 * small overlap) so each tile stays legible. A single full-page image of a long
 * article gets downscaled by any vision model until the text is unreadable;
 * bounding the tile height keeps the long edge small enough to stay sharp.
 * Tiles are returned top-to-bottom.
 *
 * Every request the page makes (navigation redirects and subresources) is
 * checked against the SSRF guard, so a public page cannot pull the browser into
 * a private/loopback host unless `allowPrivateHosts` is enabled.
 */
export async function captureTiles(
  url: URL,
  config: Config,
  fullPage: boolean,
): Promise<TilesResult> {
  const browser = await getBrowser(config);
  const width = config.viewport.width;
  const tileHeight = fullPage ? config.tileHeight : config.viewport.height;

  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: { width, height: tileHeight },
    deviceScaleFactor: 1,
  });

  // Abort subresource requests to private/loopback hosts (e.g. a public page
  // embedding <img src="http://127.0.0.1/...">). Server-side redirects of the
  // main navigation are followed inside Chromium and are NOT visible to route
  // handlers, so those are caught by the final-URL check after navigation.
  if (!config.allowPrivateHosts) {
    await context.route("**/*", (route) => {
      let host = "";
      try {
        host = new URL(route.request().url()).hostname;
      } catch {
        // Non-standard request target; let Playwright handle it.
      }
      if (host && isPrivateHost(host)) route.abort().catch(() => {});
      else route.continue().catch(() => {});
    });
  }

  try {
    const page = await context.newPage();
    let fullyLoaded = true;
    try {
      await page.goto(url.toString(), { waitUntil: "networkidle", timeout: config.navTimeoutMs });
    } catch {
      fullyLoaded = false;
      logger.warn(`networkidle wait timed out; retrying with domcontentloaded for ${url}`);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: config.navTimeoutMs });
    }

    // A server-side redirect can land on a private host the initial guard never
    // saw. Refuse before capturing anything, so internal content is never
    // returned. (The GET to the redirect target may already have happened — for
    // fully untrusted input, also front this with an egress proxy.)
    if (!config.allowPrivateHosts) {
      let finalHost = "";
      try {
        finalHost = new URL(page.url()).hostname;
      } catch {
        // ignore unparseable final URL
      }
      if (finalHost && isPrivateHost(finalHost)) {
        throw new BlockedHostError(
          `Refusing to render private/loopback host "${finalHost}" reached via redirect. ` +
            `Set PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS=true to override.`,
        );
      }
    }

    if (!fullPage) {
      const buf = await page.screenshot({ type: "png" });
      return {
        tiles: [{ base64: buf.toString("base64"), index: 1, total: 1, width, height: tileHeight }],
        finalUrl: page.url(),
        pageWidth: width,
        pageHeight: tileHeight,
        truncated: false,
        fullyLoaded,
      };
    }

    const pageHeight = await page.evaluate(() =>
      Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
      ),
    );

    const overlap = Math.min(config.tileOverlap, Math.floor(tileHeight / 2));
    const step = Math.max(1, tileHeight - overlap);
    const maxScrollY = Math.max(0, pageHeight - tileHeight);

    const offsets: number[] = [];
    for (let y = 0; y <= maxScrollY && offsets.length < config.maxTiles; y += step) {
      offsets.push(y);
    }
    if (offsets.length === 0) offsets.push(0);
    const lastOffset = offsets[offsets.length - 1];
    if (lastOffset < maxScrollY && offsets.length < config.maxTiles) {
      offsets.push(maxScrollY);
    }
    const coveredBottom = offsets[offsets.length - 1] + tileHeight;
    const truncated = pageHeight > coveredBottom + 1;

    const tiles: Tile[] = [];
    for (let i = 0; i < offsets.length; i++) {
      const y = offsets[i];
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120); // let lazy-loaded content settle
      const buf = await page.screenshot({ type: "png" });
      tiles.push({
        base64: buf.toString("base64"),
        index: i + 1,
        total: offsets.length,
        width,
        height: tileHeight,
      });
    }

    return { tiles, finalUrl: page.url(), pageWidth: width, pageHeight, truncated, fullyLoaded };
  } catch (err) {
    if (err instanceof PixelScraperError) throw err;
    throw new BrowserError(`Failed to screenshot ${url}: ${errMsg(err)}`);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Close the shared browser, if one was opened. Safe to call multiple times. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}
