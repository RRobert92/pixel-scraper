import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { Config } from "./config.js";
import { fetchAndExtract } from "./traditional.js";

function testConfig(over: Partial<Config> = {}): Config {
  return {
    navTimeoutMs: 30_000,
    fetchTimeoutMs: 15_000,
    minTextLength: 200,
    maxResponseBytes: 8_000_000,
    userAgent: "test-agent",
    headless: true,
    viewport: { width: 1280, height: 1024 },
    tileHeight: 1400,
    tileOverlap: 100,
    maxTiles: 8,
    allowPrivateHosts: false,
    ...over,
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Finding 9: a fetch that aborts on our timeout must be reported as a timeout,
// not as a generic "HTTP request failed".
test("a timed-out fetch is reported with a clear timeout reason", async () => {
  globalThis.fetch = ((_url: string, opts?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted", "AbortError")),
      );
    })) as typeof fetch;

  const result = await fetchAndExtract(new URL("http://example.com/"), testConfig({ fetchTimeoutMs: 10 }));

  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /timed out/i);
});

// Finding 6 (review 2): the null-body path must still honor the byte cap.
test("a null-body response larger than the cap is rejected", async () => {
  const text = "x".repeat(100);
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      body: null,
      text: async () => text,
    })) as unknown as typeof fetch;

  const result = await fetchAndExtract(new URL("http://example.com/"), testConfig({ maxResponseBytes: 10 }));
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /exceeded/i);
});
