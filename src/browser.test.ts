import assert from "node:assert/strict";
import { test } from "node:test";

import { isBrowserNotInstalled, launchWithAutoInstall } from "./browser.js";
import { BrowserError } from "./errors.js";

// A stand-in for a launched Browser; the auto-install logic never touches it.
const BROWSER = { id: "browser" } as const;

// Playwright's exact wording when the browser binary has not been downloaded.
const MISSING =
  "browserType.launch: Executable doesn't exist at " +
  "/Users/x/Library/Caches/ms-playwright/chromium-1228/chrome-mac/Chromium";

// --- isBrowserNotInstalled ---

test("isBrowserNotInstalled detects Playwright's missing-executable error", () => {
  assert.equal(isBrowserNotInstalled(new Error(MISSING)), true);
});

test("isBrowserNotInstalled ignores unrelated launch failures", () => {
  assert.equal(isBrowserNotInstalled(new Error("Target page, context or browser has been closed")), false);
});

test("isBrowserNotInstalled tolerates non-Error values", () => {
  assert.equal(isBrowserNotInstalled("nope"), false);
  assert.equal(isBrowserNotInstalled(undefined), false);
});

// --- launchWithAutoInstall ---

test("launchWithAutoInstall returns the browser and never installs when launch succeeds", async () => {
  let installs = 0;
  const browser = await launchWithAutoInstall({
    launch: async () => BROWSER,
    installBrowser: async () => {
      installs++;
    },
    log: () => {},
  });
  assert.equal(browser, BROWSER);
  assert.equal(installs, 0);
});

test("launchWithAutoInstall installs the browser then retries when it is missing", async () => {
  let installs = 0;
  let launches = 0;
  const browser = await launchWithAutoInstall({
    launch: async () => {
      launches++;
      if (launches === 1) throw new Error(MISSING);
      return BROWSER;
    },
    installBrowser: async () => {
      installs++;
    },
    log: () => {},
  });
  assert.equal(browser, BROWSER);
  assert.equal(installs, 1);
  assert.equal(launches, 2);
});

test("launchWithAutoInstall does not install for unrelated launch failures", async () => {
  let installs = 0;
  await assert.rejects(
    () =>
      launchWithAutoInstall({
        launch: async () => {
          throw new Error("Target page crashed");
        },
        installBrowser: async () => {
          installs++;
        },
        log: () => {},
      }),
    (err: unknown) => err instanceof BrowserError && /Target page crashed/.test(err.message),
  );
  assert.equal(installs, 0);
});

test("launchWithAutoInstall surfaces a clear error when the install itself fails", async () => {
  let launches = 0;
  await assert.rejects(
    () =>
      launchWithAutoInstall({
        launch: async () => {
          launches++;
          throw new Error(MISSING);
        },
        installBrowser: async () => {
          throw new Error("network down");
        },
        log: () => {},
      }),
    (err: unknown) =>
      err instanceof BrowserError && /install/i.test(err.message) && /network down/.test(err.message),
  );
  // The launch is not retried after a failed install.
  assert.equal(launches, 1);
});

test("launchWithAutoInstall installs at most once even if the browser is still missing afterward", async () => {
  let installs = 0;
  let launches = 0;
  await assert.rejects(
    () =>
      launchWithAutoInstall({
        launch: async () => {
          launches++;
          throw new Error(MISSING);
        },
        installBrowser: async () => {
          installs++;
        },
        log: () => {},
      }),
    (err: unknown) => err instanceof BrowserError,
  );
  assert.equal(installs, 1);
  assert.equal(launches, 2); // initial attempt + one retry, then give up — no loop
});
