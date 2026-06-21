import * as cheerio from "cheerio";

import type { Config } from "./config.js";
import { FetchError, PixelScraperError } from "./errors.js";
import type { TraditionalExtraction } from "./types.js";
import { validateUrl } from "./url.js";
import { errMsg } from "./util.js";

const MAX_REDIRECTS = 5;

/**
 * The free, traditional path: a plain HTTP fetch plus HTML parsing.
 *
 * Redirects are followed manually and every hop is re-validated against the
 * SSRF guard, so a public URL cannot bounce the request into a private or
 * loopback host. The response body is read with a byte cap to avoid memory
 * exhaustion on hostile or runaway pages.
 *
 * Returns a not-`ok` extraction (with a `reason`) for ordinary failures so the
 * caller can decide whether to render the page instead. A blocked redirect
 * target is a security event and is thrown (BlockedHostError), not swallowed.
 */
export async function fetchAndExtract(
  url: URL,
  config: Config,
): Promise<TraditionalExtraction> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.fetchTimeoutMs);

  try {
    const res = await fetchSafely(url, config, controller.signal);

    if (!res.ok) {
      return emptyExtraction(res.status, `HTTP status ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const looksTextual =
      contentType.includes("html") ||
      contentType.includes("xml") ||
      contentType.startsWith("text/");
    if (!looksTextual) {
      return emptyExtraction(res.status, `Non-HTML content type: ${contentType || "unknown"}`);
    }

    const body = await readCapped(res, config.maxResponseBytes);
    if (body === null) {
      return emptyExtraction(res.status, `Response exceeded the ${config.maxResponseBytes}-byte limit.`);
    }

    if (!contentType.includes("html") && !contentType.includes("xml")) {
      return { ...emptyExtraction(res.status), text: normalizeWhitespace(body) };
    }
    return parseHtml(body, res.status);
  } catch (err) {
    // Security blocks (e.g. a redirect into a private host) must surface, not
    // be reported as a generic failure.
    if (err instanceof PixelScraperError) throw err;
    if (timedOut) {
      return emptyExtraction(null, `Traditional fetch timed out after ${config.fetchTimeoutMs}ms`);
    }
    return emptyExtraction(null, `HTTP request failed: ${errMsg(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL, following redirects manually and re-validating every hop. */
async function fetchSafely(start: URL, config: Config, signal: AbortSignal): Promise<Response> {
  const headers = {
    "user-agent": config.userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };

  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.toString(), { redirect: "manual", signal, headers });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      const next = new URL(location, current);
      // Throws BlockedHostError if the hop targets a private/loopback host.
      validateUrl(next.toString(), config.allowPrivateHosts);
      void res.body?.cancel();
      current = next;
      continue;
    }
    return res;
  }
  throw new FetchError(`Exceeded ${MAX_REDIRECTS} redirects starting from ${start.toString()}.`);
}

/** Read a response body as UTF-8 text, returning null if it exceeds `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const body = res.body;
  if (!body) {
    // No stream to meter incrementally; still enforce the cap on the result.
    const text = await res.text();
    return Buffer.byteLength(text, "utf-8") > maxBytes ? null : text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Parse an HTML string into a structured extraction. Exported for testing. */
export function parseHtml(html: string, status: number | null): TraditionalExtraction {
  const $ = cheerio.load(html);

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD.
    }
  });

  const openGraph: Record<string, string> = {};
  const meta: Record<string, string> = {};
  $("meta").each((_, el) => {
    const property = $(el).attr("property");
    const name = $(el).attr("name");
    const content = $(el).attr("content");
    if (!content) return;
    if (property?.startsWith("og:")) openGraph[property.slice(3)] = content;
    if (name) meta[name] = content;
    if (property && !property.startsWith("og:")) meta[property] = content;
  });

  const title = $("title").first().text().trim() || openGraph["title"] || null;
  const description = meta["description"] || openGraph["description"] || null;
  const tables = extractTables($);

  // Strip non-content nodes before reading visible text.
  $("script, style, noscript, template, svg, iframe, link").remove();
  const root = $("main").length
    ? $("main")
    : $("article").length
      ? $("article")
      : $("body");
  const text = normalizeWhitespace(root.text());

  return { ok: true, status, title, description, text, jsonLd, openGraph, meta, tables };
}

/** True when the traditional extraction is good enough to skip the visual fallback. */
export function isSufficient(
  extraction: TraditionalExtraction,
  minTextLength: number,
): boolean {
  return extraction.ok && extraction.text.length >= minTextLength;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTables($: cheerio.CheerioAPI): string[][][] {
  const tables: string[][][] = [];
  $("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_unused, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("th, td")
          .each((_c, cell) => {
            cells.push(normalizeWhitespace($(cell).text()));
          });
        if (cells.length) rows.push(cells);
      });
    if (rows.length) tables.push(rows);
  });
  return tables;
}

function emptyExtraction(status: number | null, reason?: string): TraditionalExtraction {
  return {
    ok: reason === undefined,
    status,
    title: null,
    description: null,
    text: "",
    jsonLd: [],
    openGraph: {},
    meta: {},
    tables: [],
    reason,
  };
}
