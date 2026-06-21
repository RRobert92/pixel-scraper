import assert from "node:assert/strict";
import { test } from "node:test";

import type { TilesResult } from "./browser.js";
import { InvalidSchemaError } from "./errors.js";
import { assertUsableSchema, buildVisualResult, captureNotes, chooseSchemaPath } from "./scrape.js";
import type { TraditionalExtraction } from "./types.js";

function tilesResult(over: Partial<TilesResult> = {}): TilesResult {
  return {
    tiles: [],
    finalUrl: "http://example.com/",
    pageWidth: 1280,
    pageHeight: 2000,
    truncated: false,
    fullyLoaded: true,
    ...over,
  };
}

function okExtraction(over: Partial<TraditionalExtraction> = {}): TraditionalExtraction {
  return {
    ok: true,
    status: 200,
    title: null,
    description: null,
    text: "",
    jsonLd: [],
    openGraph: {},
    meta: {},
    tables: [],
    ...over,
  };
}

function failedExtraction(reason = "HTTP status 500"): TraditionalExtraction {
  return { ...okExtraction(), ok: false, status: 500, reason };
}

// Finding 5: "traditional" mode must NEVER render, even when the fetch failed.
test("traditional mode does not render when the fetch failed", () => {
  const decision = chooseSchemaPath({ properties: { title: {} } }, failedExtraction(), "traditional");
  assert.equal(decision.render, false);
});

test("traditional mode does not render when the schema is unsatisfied", () => {
  const decision = chooseSchemaPath(
    { properties: { title: {} }, required: ["title"] },
    okExtraction(),
    "traditional",
  );
  assert.equal(decision.render, false);
});

// auto mode keeps the visual fallback for genuine failures.
test("auto mode renders when the fetch failed", () => {
  const decision = chooseSchemaPath({ properties: { title: {} } }, failedExtraction(), "auto");
  assert.equal(decision.render, true);
});

test("auto mode renders when embedded data cannot satisfy required fields", () => {
  const decision = chooseSchemaPath(
    { properties: { title: {} }, required: ["title"] },
    okExtraction(),
    "auto",
  );
  assert.equal(decision.render, true);
});

// Finding 7 (review 2): a schema that declares no properties is rejected, not rendered.
test("assertUsableSchema rejects a schema with no properties", () => {
  assert.throws(() => assertUsableSchema({}), InvalidSchemaError);
  assert.throws(() => assertUsableSchema({ properties: {} }), InvalidSchemaError);
});

test("assertUsableSchema accepts a schema with at least one property", () => {
  assert.doesNotThrow(() => assertUsableSchema({ properties: { title: {} } }));
});

// Finding 14: the shared visual-result builder maps capture + extraction fields.
test("buildVisualResult maps fields and marks auto mode as a fallback", () => {
  const result = buildVisualResult({
    url: new URL("http://example.com/page"),
    shots: tilesResult({ finalUrl: "http://final/", truncated: true }),
    extraction: { ...okExtraction(), title: "T", description: "D" },
    mode: "auto",
    instruction: "do it",
    notes: ["n1"],
  });
  assert.equal(result.method, "visual");
  assert.equal(result.url, "http://example.com/page");
  assert.equal(result.finalUrl, "http://final/");
  assert.equal(result.fellBack, true);
  assert.equal(result.truncated, true);
  assert.equal(result.title, "T");
  assert.equal(result.description, "D");
  assert.equal(result.instruction, "do it");
  assert.deepEqual(result.notes, ["n1"]);
});

test("buildVisualResult is not a fallback in forced visual mode and tolerates no extraction", () => {
  const result = buildVisualResult({
    url: new URL("http://example.com/"),
    shots: tilesResult(),
    extraction: null,
    mode: "visual",
    instruction: "x",
    notes: [],
  });
  assert.equal(result.fellBack, false);
  assert.equal(result.title, null);
  assert.equal(result.description, null);
});

// Finding 13: a page captured after only domcontentloaded must warn the caller.
test("captureNotes warns when the page was not fully loaded", () => {
  const notes = captureNotes(tilesResult({ fullyLoaded: false }), 8);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /network idle|fully load|DOM/i);
});

test("captureNotes is empty for a clean, fully-loaded capture", () => {
  assert.deepEqual(captureNotes(tilesResult(), 8), []);
});

test("captureNotes reports truncation and partial load together", () => {
  const notes = captureNotes(tilesResult({ truncated: true, fullyLoaded: false, tiles: [] }), 8);
  assert.equal(notes.length, 2);
});

// Finding 6: a schema with no `required` list must not be declared satisfied
// after only one of its properties matched — auto mode should render to try
// for the rest.
test("auto mode renders a no-required schema that is only partially filled", () => {
  const extraction = okExtraction({ openGraph: { title: "Hello" } });
  const decision = chooseSchemaPath(
    { properties: { title: {}, price: {}, sku: {} } },
    extraction,
    "auto",
  );
  assert.equal(decision.render, true);
});

test("auto mode accepts a no-required schema when every property is filled", () => {
  const extraction = okExtraction({ openGraph: { title: "Hello", price: "9.99", sku: "X1" } });
  const decision = chooseSchemaPath(
    { properties: { title: {}, price: {}, sku: {} } },
    extraction,
    "auto",
  );
  assert.equal(decision.render, false);
  if (decision.render === false) {
    assert.deepEqual(decision.data, { title: "Hello", price: "9.99", sku: "X1" });
  }
});
