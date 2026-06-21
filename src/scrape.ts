import { captureTiles, type Tile, type TilesResult } from "./browser.js";
import type { Config } from "./config.js";
import { InvalidSchemaError } from "./errors.js";
import { coerceToSchema, collectStructuredData } from "./schema.js";
import { fetchAndExtract, isSufficient } from "./traditional.js";
import type { TraditionalExtraction } from "./types.js";
import { validateUrl } from "./url.js";

/** How to decide between the free and rendered paths. */
export type ScrapeMode = "auto" | "traditional" | "visual";

/** Free traditional result for the text tool. */
export interface TextDataResult {
  method: "traditional";
  url: string;
  fellBack: false;
  title: string | null;
  description: string | null;
  text: string;
  notes: string[];
}

/** Free traditional result for the schema tool. */
export interface SchemaDataResult {
  method: "traditional";
  url: string;
  fellBack: false;
  data: unknown;
  notes: string[];
}

/**
 * Rendered result: screenshot tiles plus an instruction for the host assistant
 * to read them. The plugin does NOT call any model — extraction happens in the
 * caller's own Claude session.
 */
export interface ScreenshotsResult {
  method: "visual";
  url: string;
  finalUrl: string;
  fellBack: boolean;
  title: string | null;
  description: string | null;
  instruction: string;
  notes: string[];
  truncated: boolean;
  tiles: Tile[];
}

export interface ScrapePageOptions {
  url: string;
  instruction?: string;
  mode?: ScrapeMode;
  fullPage?: boolean;
}

export interface ScrapeSchemaOptions {
  url: string;
  schema: Record<string, unknown>;
  instruction?: string;
  mode?: ScrapeMode;
  fullPage?: boolean;
}

function tileNote(count: number, maxTiles: number): string {
  return `Page was taller than ${maxTiles} tiles; captured the top ${count}. Raise PIXEL_SCRAPER_MAX_TILES for more.`;
}

/** Shared opening sentence for the host-side extraction instruction. */
function tilePreamble(tileCount: number): string {
  return `The page has been rendered into ${tileCount} screenshot tile(s) below, ordered top to bottom. `;
}

/** Assemble the rendered (visual) result returned by both scrape tools. */
export function buildVisualResult(args: {
  url: URL;
  shots: TilesResult;
  extraction: TraditionalExtraction | null;
  mode: ScrapeMode;
  instruction: string;
  notes: string[];
}): ScreenshotsResult {
  const { url, shots, extraction, mode, instruction, notes } = args;
  return {
    method: "visual",
    url: url.toString(),
    finalUrl: shots.finalUrl,
    fellBack: mode === "auto",
    title: extraction?.title ?? null,
    description: extraction?.description ?? null,
    instruction,
    notes,
    truncated: shots.truncated,
    tiles: shots.tiles,
  };
}

/** Caveats about a screenshot capture worth surfacing to the caller. */
export function captureNotes(shots: TilesResult, maxTiles: number): string[] {
  const notes: string[] = [];
  if (shots.truncated) notes.push(tileNote(shots.tiles.length, maxTiles));
  if (!shots.fullyLoaded) {
    notes.push(
      "The page did not reach network idle within the navigation timeout and was captured after the DOM loaded; " +
        "late-loading content may be missing.",
    );
  }
  return notes;
}

/**
 * Reject a schema that declares no properties. Such a schema asks for nothing,
 * so neither extracting nor rendering it is meaningful — fail fast with a clear
 * message instead of fetching and rendering the whole page for no fields.
 */
export function assertUsableSchema(schema: Record<string, unknown>): void {
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) {
    throw new InvalidSchemaError("The schema must declare at least one property under `properties`.");
  }
}

/** Outcome of the traditional-vs-render decision for the schema tool. */
export type SchemaDecision =
  | { render: false; data: Record<string, unknown>; note: string }
  | { render: true; note: string };

/**
 * Decide whether the schema can be satisfied from embedded structured data, or
 * whether the page must be rendered. Pure (no I/O) so the branching is testable.
 *
 * `traditional` mode never renders: it always returns a traditional result, even
 * when the fetch failed or the schema is unsatisfied — that is the contract of
 * the "always free, text only" mode.
 */
export function chooseSchemaPath(
  schema: Record<string, unknown>,
  extraction: TraditionalExtraction,
  mode: ScrapeMode,
): SchemaDecision {
  if (!extraction.ok) {
    const reason = extraction.reason ?? "unknown";
    if (mode === "traditional") {
      return { render: false, data: {}, note: `Traditional extraction did not fully succeed: ${reason}.` };
    }
    return { render: true, note: `Traditional extraction failed (${reason}); rendering the page for visual extraction.` };
  }

  const record = collectStructuredData(extraction);
  const { data } = coerceToSchema(schema, record);

  // Fields the schema asks for: the explicit `required` list, or — when none is
  // given — every declared property. Without this, a no-required schema would be
  // declared "satisfied" the moment a single optional field matched, silently
  // returning partial data instead of rendering for the rest.
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  const required = (schema as { required?: string[] }).required ?? [];
  const targets = required.length > 0 ? required : Object.keys(properties);
  const stillMissing = targets.filter((key) => !Object.hasOwn(data, key));
  const sufficient = stillMissing.length === 0 && Object.keys(data).length > 0;
  const missing = stillMissing.join(", ") || "no fields matched";

  if (mode === "traditional" || sufficient) {
    return {
      render: false,
      data,
      note: sufficient
        ? "Filled every field the schema asks for from embedded structured data (JSON-LD / Open Graph / meta)."
        : `Traditional extraction could not fully satisfy the schema (missing: ${missing}).`,
    };
  }
  return {
    render: true,
    note: `Embedded structured data did not cover all requested fields (missing: ${missing}); rendering the page for visual extraction.`,
  };
}

/**
 * Scrape readable text. Tries the free traditional path first and renders the
 * page to screenshot tiles only when needed (unless `mode` forces one path).
 */
export async function runScrapePage(
  opts: ScrapePageOptions,
  config: Config,
): Promise<TextDataResult | ScreenshotsResult> {
  const url = validateUrl(opts.url, config.allowPrivateHosts);
  const mode = opts.mode ?? "auto";
  const notes: string[] = [];
  let extraction: TraditionalExtraction | null = null;

  if (mode !== "visual") {
    extraction = await fetchAndExtract(url, config);
    const accept = mode === "traditional" || isSufficient(extraction, config.minTextLength);
    if (accept) {
      if (mode === "traditional" && !extraction.ok) {
        notes.push(`Traditional extraction did not fully succeed: ${extraction.reason ?? "unknown"}.`);
      }
      return {
        method: "traditional",
        url: url.toString(),
        fellBack: false,
        title: extraction.title,
        description: extraction.description,
        text: extraction.text,
        notes,
      };
    }
    notes.push(
      extraction.ok
        ? `Traditional extraction returned only ${extraction.text.length} characters (below the ${config.minTextLength}-character threshold); rendering the page for visual extraction.`
        : `Traditional extraction failed (${extraction.reason ?? "unknown"}); rendering the page for visual extraction.`,
    );
  }

  const shots = await captureTiles(url, config, opts.fullPage ?? true);
  notes.push(...captureNotes(shots, config.maxTiles));

  const ask = opts.instruction?.trim() || "extract the main readable content and any key information from the page";
  const instruction =
    tilePreamble(shots.tiles.length) +
    `Read all tiles and ${ask}. Base your answer only on what is visible in the tiles.`;

  return buildVisualResult({ url, shots, extraction, mode, instruction, notes });
}

/**
 * Extract structured data matching a JSON schema. Tries to satisfy the schema
 * from embedded structured data for free; renders the page to tiles otherwise.
 */
export async function runScrapeWithSchema(
  opts: ScrapeSchemaOptions,
  config: Config,
): Promise<SchemaDataResult | ScreenshotsResult> {
  assertUsableSchema(opts.schema);
  const url = validateUrl(opts.url, config.allowPrivateHosts);
  const mode = opts.mode ?? "auto";
  const notes: string[] = [];
  let extraction: TraditionalExtraction | null = null;

  if (mode !== "visual") {
    extraction = await fetchAndExtract(url, config);
    const decision = chooseSchemaPath(opts.schema, extraction, mode);
    notes.push(decision.note);
    if (!decision.render) {
      return { method: "traditional", url: url.toString(), fellBack: false, data: decision.data, notes };
    }
  }

  const shots = await captureTiles(url, config, opts.fullPage ?? true);
  notes.push(...captureNotes(shots, config.maxTiles));

  const extra = opts.instruction?.trim();
  const instruction =
    tilePreamble(shots.tiles.length) +
    `Extract the data described by this JSON schema and respond with ONLY valid JSON conforming to it:\n\n` +
    `${JSON.stringify(opts.schema, null, 2)}` +
    (extra ? `\n\nAdditional guidance: ${extra}` : "");

  return buildVisualResult({ url, shots, extraction, mode, instruction, notes });
}
