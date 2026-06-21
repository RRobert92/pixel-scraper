import { BlockedHostError, InvalidUrlError } from "./errors.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

/**
 * Validate a user-supplied URL and apply a best-effort SSRF guard.
 *
 * Note: this is a literal-host check only. It does NOT resolve DNS, so it
 * cannot stop DNS-rebinding attacks. For untrusted input in a hardened
 * deployment, run the server behind an egress proxy as well.
 */
export function validateUrl(raw: string, allowPrivateHosts: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidUrlError(`Not a valid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidUrlError(
      `Only http and https URLs are supported, got "${url.protocol}".`,
    );
  }

  if (!allowPrivateHosts && isPrivateHost(url.hostname)) {
    throw new BlockedHostError(
      `Refusing to access private or loopback host "${url.hostname}". ` +
        `Set PIXEL_SCRAPER_ALLOW_PRIVATE_HOSTS=true to override.`,
    );
  }

  return url;
}

/**
 * True when `hostname` is a private, loopback, or otherwise non-public literal.
 *
 * IPv6-specific ranges (loopback, link-local, unique-local, IPv4-mapped) are
 * only applied to actual IPv6 literals — a hostname like "fcc.gov" or
 * "fdic.gov" is a normal public name, not an fc00::/7 address.
 */
export function isPrivateHost(hostname: string): boolean {
  // Lowercase, drop IPv6 brackets, and drop a single trailing dot (a
  // fully-qualified "localhost." resolves to the same host as "localhost").
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.endsWith(".")) host = host.slice(0, -1);

  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost")) return true;

  // A colon (after stripping brackets) means an IPv6 literal.
  if (host.includes(":")) return isPrivateIpv6(host);

  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);

  return false;
}

/** Parse a dotted-quad IPv4 literal into four octets, or null if it is not one. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => o > 255)) return null;
  return octets as [number, number, number, number];
}

/** True for IPv4 ranges that are not publicly routable. */
function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0) return true; //                         0.0.0.0/8 "this" network
  if (a === 10) return true; //                        10.0.0.0/8 private
  if (a === 127) return true; //                       127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; //          169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; //  172.16.0.0/12 private
  if (a === 192 && b === 168) return true; //          192.168.0.0/16 private
  if (a >= 224) return true; //                        224.0.0.0/4 multicast, 240.0.0.0/4 + broadcast reserved
  return false;
}

/** True for IPv6 literals that are loopback, link/unique-local, or map to a private IPv4. */
function isPrivateIpv6(host: string): boolean {
  const h = expandIpv6(host);
  if (!h) return true; // looks like IPv6 but we can't parse it — fail closed

  if (h.every((x) => x === 0)) return true; //                   :: unspecified
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1 loopback

  // IPv4-mapped (::ffff:0:0/96) and the deprecated IPv4-compatible (::/96)
  // forms carry an IPv4 address in the last two hextets.
  const mapped = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff;
  const compat = h.slice(0, 6).every((x) => x === 0) && (h[6] !== 0 || h[7] !== 0);
  if (mapped || compat) {
    return isPrivateIpv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }

  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

/**
 * Expand an IPv6 literal (with `::` compression and optional trailing IPv4)
 * into eight 16-bit hextets, or null if it is malformed.
 */
function expandIpv6(input: string): number[] | null {
  const host = input.split("%")[0]; // drop any zone id
  if (!host.includes(":")) return null;

  // A trailing dotted-quad (e.g. ::ffff:127.0.0.1) becomes two hextets.
  let head = host;
  let tail: number[] = [];
  const lastColon = host.lastIndexOf(":");
  const lastGroup = host.slice(lastColon + 1);
  if (lastGroup.includes(".")) {
    const v4 = parseIpv4(lastGroup);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    head = host.slice(0, lastColon + 1); // keep the trailing colon for splitting
  }

  const sides = head.split("::");
  if (sides.length > 2) return null; // more than one "::" is invalid

  const toHextets = (s: string): number[] =>
    s ? s.split(":").filter((x) => x !== "").map((x) => parseInt(x, 16)) : [];

  const left = toHextets(sides[0]);
  const right = sides.length === 2 ? [...toHextets(sides[1]), ...tail] : [];
  const leftWithTail = sides.length === 2 ? left : [...left, ...tail];

  let hextets: number[];
  if (sides.length === 2) {
    const fill = 8 - (leftWithTail.length + right.length);
    if (fill < 0) return null;
    hextets = [...leftWithTail, ...new Array<number>(fill).fill(0), ...right];
  } else {
    hextets = leftWithTail;
  }

  if (hextets.length !== 8) return null;
  if (hextets.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
  return hextets;
}
