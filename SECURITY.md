# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via this repository's **Security → Report a vulnerability** (GitHub Security Advisories) rather than opening a public issue. You should receive an acknowledgement within a few days.

## Supported versions

Only the latest `0.x` release receives security fixes while the project is pre-1.0.

## What this tool does (threat model)

Pixel Scraper fetches arbitrary user-supplied URLs over HTTP, optionally renders them in a headless browser, and returns the page's text or a screenshot **into an LLM's context** (your Claude Code session). Two consequences follow:

1. It makes outbound requests to whatever URL it is given — a classic **SSRF** surface.
2. It puts **untrusted web content** in front of a language model — a **prompt-injection** surface.

The protections below mitigate these, but operators running this against fully untrusted input should add defense in depth (see "Operator responsibilities").

## Built-in protections

- **SSRF guard, on by default.** Requests to private and loopback hosts are refused: `localhost`, `127.0.0.0/8`, `10/8`, `192.168/16`, `172.16–31/16`, `169.254/16` (link-local, incl. cloud metadata `169.254.169.254`), `0.0.0.0`, and IPv6 loopback/link-local/unique-local. Disable only with `PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS=true`.
- **Redirects are re-validated.** The traditional fetch path follows redirects manually and re-checks **every hop**, so a public URL cannot 3xx-bounce the request into a private host. The browser path re-checks the **final URL** after navigation and refuses to capture private-host content.
- **Direct subresource blocking.** In the browser, requests to private hosts (e.g. a public page embedding `<img src="http://127.0.0.1/...">`) are aborted.
- **Response size cap.** Traditional responses are read with a byte limit (`PIXEL_SCRAPER_MAX_RESPONSE_BYTES`, default 8 MB) to bound memory use. Screenshots are capped at `PIXEL_SCRAPER_MAX_TILES`.
- **No shell or eval.** The server never shells out or evaluates strings; the only browser-side code executed is fixed (scroll + page-height measurement), not user input.
- **Isolated contexts.** Each request runs in a fresh, isolated browser context. The server writes no files and reads no untrusted paths.
- **Protocol-safe logging.** All diagnostics go to stderr; stdout is reserved for the MCP protocol.

## Known residual risks

- **DNS rebinding & alternate IP encodings.** The host guard is a literal check; it does **not** resolve DNS, and exotic encodings (decimal/octal/hex IPs, IPv4-mapped IPv6) may not all be caught. A hostname that resolves to a private IP can still be reached. Front the server with an egress proxy / allowlist for untrusted input.
- **Redirect-target GET (browser).** A server-side redirect to a private host is followed by Chromium before the final-URL refusal, so the GET itself may reach the internal host even though its content is never returned. The traditional path does not have this residual (it re-validates before each hop). State-changing GETs to internal services are the concern here.
- **Prompt injection.** Scraped page text and screenshots are returned into the model's context. A malicious page can contain instructions intended to manipulate the assistant. **Treat all scraped content as untrusted data, not instructions**, and do not wire the output into privileged or irreversible actions without human review.

## Operator responsibilities

- Honor `robots.txt`, site terms of service, and rate limits — this tool does not enforce them.
- For untrusted or adversarial inputs, run behind a network egress allowlist/proxy and keep `PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS` at its default (`false`).
- Keep Chromium and dependencies current (`npm audit`, `npx playwright install`).
