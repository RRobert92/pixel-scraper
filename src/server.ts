import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { captureTiles, type Tile } from "./browser.js";
import { loadConfig } from "./config.js";
import { PixelScraperError } from "./errors.js";
import { logger } from "./logger.js";
import {
  runScrapePage,
  runScrapeWithSchema,
  type SchemaDataResult,
  type ScreenshotsResult,
  type TextDataResult,
} from "./scrape.js";
import { validateUrl } from "./url.js";
import { errMsg } from "./util.js";

export const VERSION = "0.2.0";

/** The subset of the MCP CallToolResult that this server produces. */
type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

const urlField = z.string().describe("The absolute http(s) URL of the page.");
const modeField = z
  .enum(["auto", "traditional", "visual"])
  .optional()
  .describe(
    "auto (default): free traditional extraction first, screenshot-tile fallback if it is insufficient. " +
      "traditional: never render (always free, text only). visual: always render to screenshot tiles.",
  );
const fullPageField = z
  .boolean()
  .optional()
  .describe("Capture the full scrollable page as tiles rather than just the first viewport (default true).");

function imageBlocks(tiles: Tile[]): Array<{ type: "image"; data: string; mimeType: string }> {
  return tiles.map((t) => ({ type: "image" as const, data: t.base64, mimeType: "image/png" }));
}

function scrapeContent(result: TextDataResult | SchemaDataResult | ScreenshotsResult): ToolResult {
  if (result.method === "visual") {
    const { tiles, instruction, ...meta } = result;
    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify({ ...meta, tileCount: tiles.length }, null, 2)}\n\n${instruction}`,
        },
        ...imageBlocks(tiles),
      ],
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

export function createServer(): McpServer {
  const config = loadConfig();
  const server = new McpServer({ name: "pixel-scraper", version: VERSION });

  server.registerTool(
    "scrape_page",
    {
      title: "Scrape page (text)",
      description:
        "Extract readable text/content from a web page. Tries free traditional HTML extraction first " +
        "(fetch + parse). If the page is JavaScript-rendered, blocked, or returns too little text, it " +
        "renders the page and returns screenshot tiles for YOU to read and extract from in this " +
        "conversation — no external API is called and no cost is incurred beyond this session.",
      inputSchema: {
        url: urlField,
        instruction: z
          .string()
          .optional()
          .describe("What to extract (used when the page is rendered to tiles)."),
        mode: modeField,
        full_page: fullPageField,
      },
    },
    (args) =>
      guard(async () =>
        scrapeContent(
          await runScrapePage(
            { url: args.url, instruction: args.instruction, mode: args.mode, fullPage: args.full_page },
            config,
          ),
        ),
      ),
  );

  server.registerTool(
    "scrape_with_schema",
    {
      title: "Scrape page into a JSON schema",
      description:
        "Extract structured data conforming to a JSON schema you provide. Tries free traditional " +
        "extraction from embedded structured data (JSON-LD, Open Graph, meta) first. If that cannot " +
        "satisfy the schema, it renders the page to screenshot tiles for YOU to extract the JSON from " +
        "in this conversation — no external API call, no cost beyond this session.",
      inputSchema: {
        url: urlField,
        schema: z
          .record(z.any())
          .describe("A JSON Schema object (with `properties` and optional `required`)."),
        instruction: z.string().optional().describe("Optional extra guidance for the extraction."),
        mode: modeField,
        full_page: fullPageField,
      },
    },
    (args) =>
      guard(async () =>
        scrapeContent(
          await runScrapeWithSchema(
            {
              url: args.url,
              schema: args.schema as Record<string, unknown>,
              instruction: args.instruction,
              mode: args.mode,
              fullPage: args.full_page,
            },
            config,
          ),
        ),
      ),
  );

  server.registerTool(
    "screenshot_page",
    {
      title: "Screenshot a page",
      description:
        "Render a URL in a headless browser and return PNG screenshot tile(s). Tall pages are sliced " +
        "into legible top-to-bottom tiles so text stays readable. No API call, no cost beyond this session.",
      inputSchema: {
        url: urlField,
        full_page: z
          .boolean()
          .optional()
          .describe("Capture the entire scrollable page as tiles rather than just the viewport (default true)."),
      },
    },
    (args) =>
      guard(async () => {
        const url = validateUrl(args.url, config.allowPrivateHosts);
        const fullPage = args.full_page ?? true;
        const shots = await captureTiles(url, config, fullPage);
        const note =
          `Screenshot of ${shots.finalUrl} — ${shots.tiles.length} tile(s), ${shots.pageWidth}px wide, ` +
          `page height ~${shots.pageHeight}px${shots.truncated ? ` (truncated to ${config.maxTiles} tiles)` : ""}.` +
          (shots.fullyLoaded
            ? ""
            : " The page did not reach network idle within the timeout and was captured after the DOM loaded; late content may be missing.");
        return { content: [{ type: "text", text: note }, ...imageBlocks(shots.tiles)] };
      }),
  );

  logger.info(
    `pixel-scraper ${VERSION} ready (host-side extraction; tiles up to ${config.maxTiles} x ${config.tileHeight}px).`,
  );
  return server;
}

/** Run a tool handler, turning thrown errors into a clean isError result. */
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof PixelScraperError
        ? `[${err.code}] ${err.message}`
        : `[UNEXPECTED] ${errMsg(err)}`;
    logger.error(message);
    return { content: [{ type: "text", text: `pixel-scraper error: ${message}` }], isError: true };
  }
}
