import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { loadConfig } from "./config.js";
import { ConfigError } from "./errors.js";

const TOUCHED = [
  "PIXEL_SCRAPER_MAX_TILES",
  "PIXEL_SCRAPER_VIEWPORT_HEIGHT",
  "PIXEL_SCRAPER_VIEWPORT_WIDTH",
  "PIXEL_SCRAPER_TILE_HEIGHT",
  "PIXEL_SCRAPER_MAX_RESPONSE_BYTES",
  "PIXEL_SCRAPER_TILE_OVERLAP",
  "PIXEL_SCRAPER_MIN_TEXT_LENGTH",
];

afterEach(() => {
  for (const key of TOUCHED) delete process.env[key];
});

// Finding 10: values that must be positive must reject 0.
for (const key of [
  "PIXEL_SCRAPER_MAX_TILES",
  "PIXEL_SCRAPER_VIEWPORT_HEIGHT",
  "PIXEL_SCRAPER_VIEWPORT_WIDTH",
  "PIXEL_SCRAPER_TILE_HEIGHT",
  "PIXEL_SCRAPER_MAX_RESPONSE_BYTES",
]) {
  test(`${key}=0 is rejected`, () => {
    process.env[key] = "0";
    assert.throws(() => loadConfig(), ConfigError);
  });
}

// Zero is still legitimate where it has a meaning.
test("tileOverlap=0 (no overlap) and minTextLength=0 are accepted", () => {
  process.env.PIXEL_SCRAPER_TILE_OVERLAP = "0";
  process.env.PIXEL_SCRAPER_MIN_TEXT_LENGTH = "0";
  const config = loadConfig();
  assert.equal(config.tileOverlap, 0);
  assert.equal(config.minTextLength, 0);
});

// Finding 3 (review 2): non-integer numeric values are rejected (Playwright
// needs integer pixel dimensions).
test("a non-integer numeric var is rejected", () => {
  process.env.PIXEL_SCRAPER_TILE_HEIGHT = "1400.5";
  assert.throws(() => loadConfig(), ConfigError);
});

test("defaults load without any env vars", () => {
  const config = loadConfig();
  assert.equal(config.maxTiles, 8);
  assert.equal(config.tileHeight, 1400);
});
