/** Result of the free, traditional HTML extraction path. */
export interface TraditionalExtraction {
  /** True when the page was fetched and parsed without error. */
  ok: boolean;
  /** HTTP status code, or null if the request never completed. */
  status: number | null;
  title: string | null;
  description: string | null;
  /** Cleaned, whitespace-collapsed main text content. */
  text: string;
  /** Parsed JSON-LD blocks (`<script type="application/ld+json">`). */
  jsonLd: unknown[];
  /** Open Graph properties, keyed without the `og:` prefix. */
  openGraph: Record<string, string>;
  /** Other `<meta>` tags keyed by name/property. */
  meta: Record<string, string>;
  /** Tables rendered as rows of cell strings. */
  tables: string[][][];
  /** Why the extraction is not `ok`, when applicable. */
  reason?: string;
}
