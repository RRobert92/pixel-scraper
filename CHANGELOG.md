# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-21

### Changed

- **Subscription-only by design — no Anthropic API key, no extra API cost.**
  The visual path no longer calls the Anthropic API. Instead, `scrape_page`,
  `scrape_with_schema`, and `screenshot_page` return screenshot tiles (plus an
  instruction / the schema) for the host Claude Code session to read and
  extract from. Extraction runs on your existing Claude subscription.

### Added

- **Legible tiling for tall pages.** Full-page captures are sliced into bounded
  vertical tiles (default 1280×1400px, 100px overlap, up to 8 tiles) instead of
  one giant image that vision models downscale until the text is unreadable.
- Config: `PIXEL_SCRAPER_TILE_HEIGHT`, `PIXEL_SCRAPER_TILE_OVERLAP`,
  `PIXEL_SCRAPER_MAX_TILES`.

### Removed

- The `@anthropic-ai/sdk` dependency, the `ANTHROPIC_API_KEY` requirement, the
  `PIXEL_SCRAPER_VISION_MODEL` / `PIXEL_SCRAPER_MAX_TOKENS` settings, and all
  per-call cost-estimation logic (`vision.ts`, `pricing.ts`).

### Security

- **SSRF redirect hardening.** The traditional fetch path now follows redirects
  manually and re-validates every hop; the browser path re-validates the final
  URL after navigation, so a public URL can no longer 3xx-redirect into a
  private/loopback host (e.g. cloud metadata at `169.254.169.254`).
- Direct subresource requests to private hosts are blocked in the browser.
- Added a response-size cap (`PIXEL_SCRAPER_MAX_RESPONSE_BYTES`, default 8 MB).
- Added `SECURITY.md` documenting the threat model, residual risks (DNS
  rebinding, prompt injection), and how to report a vulnerability.

## [0.1.0] - 2026-06-21

### Added

- Initial release.
- MCP server exposing three tools: `scrape_page`, `scrape_with_schema`, and
  `screenshot_page`.
- Traditional-first scraping strategy: free HTTP fetch + HTML parse, with an
  automatic Claude Vision screenshot fallback when the traditional path is
  insufficient.
- Free structured-data extraction from JSON-LD, Open Graph, and meta tags for
  `scrape_with_schema`, with a Vision fallback for the rest.
- `auto` / `traditional` / `visual` modes to control the fallback behaviour.
- Configurable timeouts, viewport, text threshold, and a best-effort SSRF guard
  for private hosts.
