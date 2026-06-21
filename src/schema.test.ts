import assert from "node:assert/strict";
import { test } from "node:test";

import { coerceToSchema, collectStructuredData } from "./schema.js";
import type { TraditionalExtraction } from "./types.js";

function extractionWith(over: Partial<TraditionalExtraction> = {}): TraditionalExtraction {
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

// Finding 7: separator-insensitive matching must work in BOTH directions.
// collectStructuredData lowercases source keys but keeps their separators, so a
// camelCase schema property has to match a separator-bearing source key.
test("camelCase schema property matches a separator-bearing source key", () => {
  const { data } = coerceToSchema({ properties: { priceCurrency: {} } }, { price_currency: "USD" });
  assert.deepEqual(data, { priceCurrency: "USD" });
});

test("separator schema property matches a compact source key (reverse direction)", () => {
  const { data } = coerceToSchema({ properties: { price_currency: {} } }, { pricecurrency: "USD" });
  assert.deepEqual(data, { price_currency: "USD" });
});

test("exact lowercase match still wins and preserves falsy values", () => {
  const { data } = coerceToSchema({ properties: { stock: {} } }, { stock: 0 });
  assert.deepEqual(data, { stock: 0 });
});

// Finding 1 (review 2): a hostile deeply-nested @graph must not overflow the stack.
test("deeply nested @graph degrades gracefully instead of overflowing", () => {
  let block: Record<string, unknown> = { "@type": "Product", name: "leaf" };
  for (let i = 0; i < 10_000; i++) block = { "@graph": block };
  assert.doesNotThrow(() => collectStructuredData(extractionWith({ jsonLd: [block] })));
});

// Finding 2 (review 2): schema keys colliding with Object.prototype members must
// not be treated as already-present.
test("schema keys named after prototype members are reported missing when absent", () => {
  for (const key of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    const { data, missingRequired } = coerceToSchema({ properties: { [key]: {} }, required: [key] }, {});
    assert.deepEqual(missingRequired, [key], `${key} should be missing`);
    assert.equal(Object.hasOwn(data, key), false, `${key} should not be in data`);
  }
});

// Finding 11: a required field present in the page must be found even when it
// is not also listed under `properties`.
test("looks up required keys even when not declared in properties", () => {
  const { data, missingRequired } = coerceToSchema(
    { properties: { title: {} }, required: ["title", "sku"] },
    { title: "Hello", sku: "X1" },
  );
  assert.deepEqual(data, { title: "Hello", sku: "X1" });
  assert.deepEqual(missingRequired, []);
});

// Finding 8: @graph is valid JSON-LD both as an array AND as a single object.
test("flattens @graph when it is a single object", () => {
  const record = collectStructuredData(
    extractionWith({
      jsonLd: [{ "@context": "https://schema.org", "@graph": { "@type": "Product", name: "Widget", sku: "X1" } }],
    }),
  );
  assert.equal(record.name, "Widget");
  assert.equal(record.sku, "X1");
});

test("still flattens @graph when it is an array", () => {
  const record = collectStructuredData(
    extractionWith({
      jsonLd: [{ "@graph": [{ "@type": "Product", name: "Widget" }] }],
    }),
  );
  assert.equal(record.name, "Widget");
});
