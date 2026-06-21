import assert from "node:assert/strict";
import { test } from "node:test";

import { BlockedHostError } from "./errors.js";
import { isPrivateHost, validateUrl } from "./url.js";

/** True when validateUrl refuses the URL as a private/loopback host. */
function blocked(rawUrl: string): boolean {
  try {
    validateUrl(rawUrl, false);
    return false;
  } catch (err) {
    if (err instanceof BlockedHostError) return true;
    throw err; // an unexpected error (e.g. InvalidUrl) is a test failure
  }
}

// Hosts the SSRF guard MUST refuse. These go through new URL() exactly as the
// app sees them, so canonicalization (decimal/hex IPs, IPv6 compression) is
// covered too.
const MUST_BLOCK = [
  "http://127.0.0.1/",
  "http://localhost/",
  "http://localhost./", //                     trailing-dot loopback (finding 3)
  "http://2130706433/", //                     decimal 127.0.0.1 (canonicalized)
  "http://0x7f000001/", //                     hex 127.0.0.1 (canonicalized)
  "http://10.0.0.1/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://169.254.169.254/", //                cloud metadata
  "http://100.64.0.1/", //                     CGNAT 100.64.0.0/10 (finding 4)
  "http://255.255.255.255/", //                broadcast (finding 4)
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/", //             IPv4-mapped loopback (finding 1)
  "http://[::ffff:169.254.169.254]/", //       IPv4-mapped metadata (finding 1)
  "http://[fe80::1]/", //                      link-local
  "http://[fc00::1]/", //                      unique-local
  "http://[fd12:3456:789a::1]/", //            unique-local
];

// Legitimate public hosts the guard MUST allow.
const MUST_ALLOW = [
  "http://example.com/",
  "http://github.com/",
  "http://fcc.gov/", //                        starts with "fc" (finding 2)
  "http://fc2.com/", //                        starts with "fc" (finding 2)
  "http://fdic.gov/", //                       starts with "fd" (finding 2)
  "http://fe80.example.com/", //               starts with "fe80" (finding 2)
  "http://8.8.8.8/",
  "http://[2606:4700::1]/", //                 Cloudflare public IPv6
  "http://[2001:4860:4860::8888]/", //         Google public IPv6
  "http://[::ffff:8.8.8.8]/", //               IPv4-mapped public address
];

for (const url of MUST_BLOCK) {
  test(`blocks ${url}`, () => {
    assert.equal(blocked(url), true, `${url} should be refused as private`);
  });
}

for (const url of MUST_ALLOW) {
  test(`allows ${url}`, () => {
    assert.equal(blocked(url), false, `${url} should be allowed`);
  });
}

test("allowPrivateHosts=true overrides the guard", () => {
  assert.equal(validateUrl("http://127.0.0.1/", true).hostname, "127.0.0.1");
});

test("isPrivateHost is callable directly with a bare hostname", () => {
  assert.equal(isPrivateHost("10.0.0.1"), true);
  assert.equal(isPrivateHost("example.com"), false);
});
