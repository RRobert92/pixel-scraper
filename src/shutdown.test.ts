import assert from "node:assert/strict";
import { test } from "node:test";

import { createShutdownHandler } from "./shutdown.js";

// Finding 12: repeated or concurrent signals must run teardown exactly once.
test("teardown runs once across concurrent and repeated signals", async () => {
  let browserClosed = 0;
  let serverClosed = 0;
  let exited = 0;

  const shutdown = createShutdownHandler({
    closeBrowser: async () => {
      browserClosed++;
    },
    closeServer: async () => {
      serverClosed++;
    },
    exit: () => {
      exited++;
    },
  });

  await Promise.all([shutdown("SIGINT"), shutdown("SIGTERM")]);
  await shutdown("SIGINT");

  assert.equal(browserClosed, 1);
  assert.equal(serverClosed, 1);
  assert.equal(exited, 1);
});

// Finding 5 (review 2): a hung teardown must still force the process to exit.
test("forces exit when teardown hangs", async () => {
  let exited = -1;
  const shutdown = createShutdownHandler({
    closeBrowser: () => new Promise<void>(() => {}), // never resolves
    closeServer: async () => {},
    exit: (code) => {
      exited = code;
    },
    forceExitMs: 20,
  });

  void shutdown("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(exited, 1);
});

test("a failing server close still proceeds to exit", async () => {
  let exited = -1;
  const shutdown = createShutdownHandler({
    closeBrowser: async () => {},
    closeServer: async () => {
      throw new Error("server close failed");
    },
    exit: (code) => {
      exited = code;
    },
  });

  await shutdown("SIGTERM");
  assert.equal(exited, 0);
});
