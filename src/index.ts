#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { closeBrowser } from "./browser.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";
import { createShutdownHandler } from "./shutdown.js";
import { errMsg } from "./util.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = createShutdownHandler({
    closeBrowser,
    closeServer: () => server.close(),
    exit: (code) => process.exit(code),
    log: (message) => logger.info(message),
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.error(`Fatal: ${errMsg(err)}`);
  process.exit(1);
});
