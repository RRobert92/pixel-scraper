/** Stable error codes surfaced to callers of the MCP tools. */
export type ErrorCode =
  | "CONFIG_ERROR"
  | "INVALID_URL"
  | "INVALID_SCHEMA"
  | "BLOCKED_HOST"
  | "FETCH_ERROR"
  | "BROWSER_ERROR";

/** Base class for all errors this package raises on purpose. */
export class PixelScraperError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigError extends PixelScraperError {
  constructor(message: string) {
    super("CONFIG_ERROR", message);
  }
}

export class InvalidUrlError extends PixelScraperError {
  constructor(message: string) {
    super("INVALID_URL", message);
  }
}

export class InvalidSchemaError extends PixelScraperError {
  constructor(message: string) {
    super("INVALID_SCHEMA", message);
  }
}

export class BlockedHostError extends PixelScraperError {
  constructor(message: string) {
    super("BLOCKED_HOST", message);
  }
}

export class FetchError extends PixelScraperError {
  constructor(message: string) {
    super("FETCH_ERROR", message);
  }
}

export class BrowserError extends PixelScraperError {
  constructor(message: string) {
    super("BROWSER_ERROR", message);
  }
}
