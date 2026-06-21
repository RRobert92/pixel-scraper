import type { TraditionalExtraction } from "./types.js";

/**
 * Flatten a page's embedded structured data into a single lookup record.
 *
 * Priority (highest last): meta tags → Open Graph → JSON-LD. JSON-LD wins
 * because it is the richest, most reliable machine-readable source.
 */
export function collectStructuredData(
  extraction: TraditionalExtraction,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(extraction.meta)) {
    record[key.toLowerCase()] = value;
  }
  for (const [key, value] of Object.entries(extraction.openGraph)) {
    record[key.toLowerCase()] = value;
  }
  if (extraction.title && record["title"] === undefined) record["title"] = extraction.title;
  if (extraction.description && record["description"] === undefined) {
    record["description"] = extraction.description;
  }

  for (const block of extraction.jsonLd) {
    for (const obj of flattenJsonLd(block)) {
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith("@")) continue;
        record[key.toLowerCase()] = value;
      }
    }
  }

  return record;
}

// Bound on @graph / array recursion so a hostile, deeply-nested document cannot
// overflow the call stack. Real JSON-LD nests only a few levels deep.
const MAX_JSONLD_DEPTH = 64;

function flattenJsonLd(block: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > MAX_JSONLD_DEPTH) return [];
  if (Array.isArray(block)) return block.flatMap((node) => flattenJsonLd(node, depth + 1));
  if (block && typeof block === "object") {
    const obj = block as Record<string, unknown>;
    // @graph may be an array of nodes or a single node object; flattenJsonLd
    // handles both, so recurse on it directly rather than only on arrays.
    const nested = obj["@graph"] !== undefined ? flattenJsonLd(obj["@graph"], depth + 1) : [];
    return [obj, ...nested];
  }
  return [];
}

interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * Best-effort fill of a JSON-schema object's top-level properties from a flat
 * record. Field names are matched case-insensitively and with separators
 * stripped (so `priceCurrency`, `price_currency`, and `price-currency` all
 * match). Nested schemas are not deeply validated — this only decides whether
 * the traditional path can satisfy the schema's required fields before the
 * caller spends money on the visual fallback.
 */
export function coerceToSchema(
  schema: Record<string, unknown>,
  record: Record<string, unknown>,
): { data: Record<string, unknown>; missingRequired: string[] } {
  const typed = schema as JsonSchemaLike;
  const properties = typed.properties ?? {};
  const required = typed.required ?? [];

  // Look up declared properties AND any required key, so a required field is
  // still found when the schema lists it under `required` but not `properties`.
  const keys = new Set([...Object.keys(properties), ...required]);
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const value = lookup(record, key);
    if (value !== undefined) data[key] = value;
  }

  const missingRequired = required.filter((key) => !Object.hasOwn(data, key));
  return { data, missingRequired };
}

function compactKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, "");
}

function lookup(record: Record<string, unknown>, key: string): unknown {
  // Own-property checks only: a bare `record[key]` would read inherited members
  // (record["constructor"], record["__proto__"], …) and return junk for a schema
  // field that happens to share a name with an Object.prototype member.
  const lower = key.toLowerCase();
  if (Object.hasOwn(record, lower) && record[lower] !== undefined) return record[lower];

  // Separator-insensitive match in both directions: the source key may carry
  // separators the schema property omits (price_currency vs priceCurrency) or
  // vice versa, so compare the compacted form of every record key too.
  const compact = compactKey(key);
  for (const [recordKey, value] of Object.entries(record)) {
    if (value !== undefined && compactKey(recordKey) === compact) return value;
  }
  return undefined;
}
