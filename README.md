# Pixel Scraper

> Visual web scraping for Claude Code — free traditional HTML extraction first, with a screenshot-tile fallback that **your own Claude session reads**. No API key, no extra API cost.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Pixel Scraper is a [Claude Code plugin](https://code.claude.com/docs/en/plugins) that bundles an [MCP](https://modelcontextprotocol.io) server for scraping web pages. It is built around two ideas:

1. **Most pages don't need a browser.** Try ordinary HTML scraping first (an HTTP fetch + parse — fast and free). It works for the large majority of the web.
2. **When a page *does* need rendering, don't pay for a second model.** Instead of calling a separate vision API, the plugin renders the page and hands **screenshot tiles back to Claude Code**. The Claude you're already running — on your existing subscription — reads them and does the extraction. **No API key, no per-call API bill.**

So for a JavaScript-rendered page, an anti-scraping wall, or a `<canvas>`-heavy layout, the plugin gets the pixels in front of your Claude session and your Claude reads them.

---

## How it works

```
                    scrape_page / scrape_with_schema
                                 │
                                 ▼
                 ┌───────────────────────────────┐
                 │  1. Traditional path (FREE)   │
                 │  HTTP fetch → parse HTML      │
                 │  • text content               │
                 │  • JSON-LD / Open Graph / meta│
                 └───────────────┬───────────────┘
                                 │
                   good enough?  │
           ┌─────────────────────┴─────────────────────┐
         yes                                           no
           │                            (empty, blocked, JS-rendered,
           ▼                             missing required fields…)
 ┌──────────────────────┐                              │
 │ return data directly │                              ▼
 │ method: "traditional"│             ┌───────────────────────────────┐
 └──────────────────────┘             │  2. Render → legible tiles    │
                                      │  Playwright screenshot, sliced│
                                      │  into bounded vertical tiles  │
                                      └────────────────┬──────────────┘
                                                       │
                                                       ▼
                              return tiles + instruction to Claude Code
                              → YOUR Claude reads them and extracts
                              → method: "visual", $0 API
```

The tools never call a model themselves. On the visual path they return the screenshot tiles plus an instruction (or your JSON schema); the **host Claude** produces the extraction in the conversation.

---

## Tools

| Tool | What it does |
| --- | --- |
| `scrape_page` | Returns readable text/content. Traditional first; otherwise returns rendered tiles for your Claude to read. |
| `scrape_with_schema` | Extracts structured data for a JSON schema you provide. Fills it from embedded structured data for free when possible; otherwise returns tiles + the schema for your Claude to extract. |
| `screenshot_page` | Renders a URL and returns legible PNG tile(s). |

All three accept absolute `http(s)` URLs. `scrape_page` and `scrape_with_schema` accept a `mode`:

- `auto` *(default)* — traditional first, render to tiles if insufficient.
- `traditional` — never render; always free (may return little for JS-heavy pages).
- `visual` — always render to tiles.

### Legible tiling

A single full-page screenshot of a long article is a problem: any vision model downscales a tall image until the text is unreadable (a 1280×10270px page collapses to ~195px wide). Pixel Scraper instead slices full-page captures into **bounded vertical tiles** (default 1280×1400px) with a small overlap so no line is cut, returned top-to-bottom. Each tile stays sharp enough to read. Very long pages are capped at `PIXEL_SCRAPER_MAX_TILES` (default 8), with a note when truncated.

---

## Installation

**No API key is required.** The server renders pages with a real browser, so the first run downloads Chromium (~150 MB, one-time). Installing from npm does this automatically — there is nothing to build by hand.

### Quick install (recommended)

Register the server with Claude Code in one command; it runs straight from npm via `npx`:

```bash
claude mcp add -s user pixel-scraper -- npx -y pixel-scraper
```

`-s user` makes it available in every project (drop it to scope to the current project, or use `-s project` to share it via a checked-in `.mcp.json`). The first scrape downloads Chromium, then it is cached.

### As a Claude Code plugin (one-click, inside Claude Code)

This repo doubles as a single-plugin marketplace. From within Claude Code:

```
/plugin marketplace add RRobert92/pixel-scraper
/plugin install pixel-scraper@pixel-scraper
```

The plugin runs the published server via `npx -y pixel-scraper`, so npm handles the dependencies and the Chromium download for you.

### From source (for development)

```bash
git clone https://github.com/RRobert92/pixel-scraper.git
cd pixel-scraper
npm install
npm run build              # compiles src → dist
npm run install:browser    # downloads Chromium for Playwright (one-time)
npm run dev                # run from source (tsx); or `npm start` for the built version
npm test                   # run the test suite
```

To try your local build inside Claude Code, register it explicitly (this points at your working tree, not the published package):

```bash
claude mcp add -s local pixel-scraper-dev -- node "$(pwd)/dist/index.js"
```

> ℹ️ The host that runs the server must be **vision-capable** (Claude Code with a Claude model is). The visual path hands back images for the host model to read; a non-vision MCP client would receive the tiles but couldn't extract from them.

---

## Cost — what you actually pay

There is **no Anthropic API key and no separate API charge.** The two paths cost:

| Path | What runs | Cost |
| --- | --- | --- |
| Traditional | HTTP fetch + HTML parse | **$0** — no model at all |
| `screenshot_page` | Headless browser render | **$0** — just returns images |
| Visual extraction | Tiles returned to your Claude Code session | **$0 API** — runs on your existing Claude subscription |

The honest trade-off for the visual path: the screenshot tiles are read by the Claude you're already paying for, so there's **no extra bill**, but the tiles **consume your session's context and count toward your plan's usage limits**. Budget roughly **~1,000–1,500 image tokens per tile** (after the model's own resize), up to `PIXEL_SCRAPER_MAX_TILES` tiles per rendered page. Smaller `PIXEL_SCRAPER_TILE_HEIGHT` = sharper text but more tiles = more context used. Pages handled by the traditional path consume neither.

---

## Usage

Ask Claude Code to scrape something and it picks the right tool. The inputs:

### `scrape_page`

```jsonc
{
  "url": "https://example.com/article",
  "instruction": "Summarize the main article text",  // optional; used when rendered
  "mode": "auto",                                     // optional
  "full_page": true                                   // optional
}
```

- Traditional success → a `text` result with `method: "traditional"`, the extracted text, and `$0`.
- Visual fallback → a short metadata block + an instruction + the screenshot tiles, which your Claude reads to produce the answer.

### `scrape_with_schema`

```jsonc
{
  "url": "https://shop.example.com/product/42",
  "schema": {
    "type": "object",
    "properties": {
      "name":  { "type": "string" },
      "price": { "type": "string" },
      "inStock": { "type": "boolean" }
    },
    "required": ["name", "price"]
  }
}
```

If the page exposes JSON-LD / Open Graph data covering the required fields, you get a `traditional` result for free. Otherwise it returns the page tiles + your schema for your Claude to fill in.

### `screenshot_page`

```jsonc
{ "url": "https://example.com", "full_page": true }
```

Returns the page as one or more inline PNG tiles (plus a note with the dimensions and tile count).

---

## Configuration

All optional, via environment variables (see [`.env.example`](./.env.example)). **No key, no model setting.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PIXEL_SCRAPER_NAV_TIMEOUT_MS` | `30000` | Headless-browser navigation timeout. |
| `PIXEL_SCRAPER_FETCH_TIMEOUT_MS` | `15000` | Traditional HTTP fetch timeout. |
| `PIXEL_SCRAPER_MIN_TEXT_LENGTH` | `200` | Min extracted characters before the traditional path is accepted. |
| `PIXEL_SCRAPER_MAX_RESPONSE_BYTES` | `8000000` | Max bytes read from a traditional HTTP response (memory guard). |
| `PIXEL_SCRAPER_USER_AGENT` | (a descriptive UA) | User-Agent for fetch + browser. |
| `PIXEL_SCRAPER_HEADLESS` | `true` | Run Chromium headless. |
| `PIXEL_SCRAPER_VIEWPORT_WIDTH` | `1280` | Page width (and tile width). |
| `PIXEL_SCRAPER_VIEWPORT_HEIGHT` | `1024` | Tile height for non-full-page captures. |
| `PIXEL_SCRAPER_TILE_HEIGHT` | `1400` | Height of each full-page tile. |
| `PIXEL_SCRAPER_TILE_OVERLAP` | `100` | Vertical overlap between tiles. |
| `PIXEL_SCRAPER_MAX_TILES` | `8` | Max tiles captured per page. |
| `PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS` | `false` | Allow scraping private/loopback hosts. |
| `PIXEL_SCRAPER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

---

## Security & limitations

- **SSRF guard, on by default.** The server refuses private and loopback hosts (`localhost`, `127.0.0.0/8`, `10/8`, `192.168/16`, `172.16–31/16`, `169.254/16` link-local incl. cloud metadata, IPv6 loopback/ULA). **Redirects are re-validated**: the fetch path re-checks every hop, and the browser path re-checks the final URL after navigation, so a public URL can't 3xx-bounce into an internal host. It's a literal-host check, though — it does **not** resolve DNS, so it can't stop DNS-rebinding or every exotic IP encoding. For untrusted input, also run behind an egress proxy. Set `PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS=true` to disable the guard.
- **Prompt injection.** Scraped text and screenshots are returned into your Claude session, so a malicious page can contain instructions aimed at the assistant. Treat scraped content as untrusted **data, not instructions**, and don't wire the output into privileged or irreversible actions without review.
- **Respect the sites you scrape.** Honor `robots.txt`, terms of service, and rate limits. This tool does not enforce them for you.
- **The traditional schema path is best-effort.** It fills a schema from embedded structured data (JSON-LD / Open Graph / meta) and matches field names case-insensitively. Pages without machine-readable data are rendered to tiles instead.
- **Vision happens in your session.** On the visual path the plugin returns pixels, not finished data — the extraction is produced by your Claude Code model. The host must be vision-capable.
- **One browser, many contexts.** A single Chromium instance is shared and reused across calls; each request gets a fresh, isolated context.

See [SECURITY.md](./SECURITY.md) for the full threat model, residual risks, and how to report a vulnerability.

---

## Development

```bash
npm install
npm run build         # compile to dist/
npm run typecheck     # type-check without emitting
npm run watch         # recompile on change
npm run dev           # run from source via tsx (stdio MCP server)
```

The server speaks MCP over stdio. All logs go to **stderr** (stdout is reserved for the protocol).

### Project layout

```
src/
  index.ts        # entry point — starts the stdio MCP server
  server.ts       # registers the three MCP tools, formats results + tiles
  scrape.ts       # orchestration: traditional-first, render-to-tiles fallback
  traditional.ts  # HTTP fetch + HTML/JSON-LD/OG parsing (cheerio)
  browser.ts      # Playwright lifecycle + legible vertical tiling
  schema.ts       # fill a JSON schema from embedded structured data
  url.ts          # URL validation + SSRF guard
  config.ts       # environment-driven configuration
```

---

## License

[MIT](./LICENSE) © 2026 Robert Kiewisz
