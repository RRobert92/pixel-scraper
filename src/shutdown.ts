import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

/** Side effects a graceful shutdown needs, injected so the handler is testable. */
export interface ShutdownDeps {
  closeBrowser: () => Promise<void>;
  closeServer: () => Promise<void>;
  exit: (code: number) => void;
  log?: (message: string) => void;
  /** Milliseconds to wait for a clean teardown before forcing exit. Default 5000. */
  forceExitMs?: number;
}

/**
 * Build a signal handler that tears down once, even if several signals arrive
 * (SIGINT then SIGTERM) or arrive concurrently. The guard is set synchronously
 * before the first await, so a second invocation can never start a parallel
 * teardown or reach a second `exit`.
 *
 * A force-exit timer guarantees the process still terminates if `closeBrowser`
 * or `closeServer` hangs — otherwise the re-entrancy guard would swallow a
 * follow-up Ctrl-C and leave the process wedged.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    deps.log?.(`Received ${signal}, shutting down.`);

    let forced = false;
    const timer = setNodeTimeout(() => {
      forced = true;
      deps.exit(1);
    }, deps.forceExitMs ?? 5000);
    timer.unref(); // do not keep the event loop alive just for this safety net

    await deps.closeBrowser().catch(() => {});
    await deps.closeServer().catch(() => {});

    clearNodeTimeout(timer);
    if (!forced) deps.exit(0);
  };
}
