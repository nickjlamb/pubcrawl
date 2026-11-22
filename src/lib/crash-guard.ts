/**
 * Keeps the HTTP server alive through one known upstream bug.
 *
 * undici 7's HTTP/1 client asserts `!this.paused` in `Parser.finish()` when a
 * remote host closes a connection while the response body is paused by
 * backpressure. The assertion is thrown from a socket `end` event, so no
 * `fetch()` caller can catch it and it would otherwise end the process. (The
 * `undici` npm package is loaded by cheerio and registers itself as the global
 * dispatcher, so Node's built-in `fetch` runs through it.) undici 8 handles this
 * case but needs Node 22.19+, which is newer than this package's Node 20 floor.
 *
 * The failure is confined to one outbound connection: the affected request ends
 * through its own timeout. Anything else uncaught still stops the process, as
 * Node does by default, so the host can restart it.
 */

/** True for the undici HTTP/1 parser assertion described above, and nothing else. */
export function isUndiciParserAssertion(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as NodeJS.ErrnoException).code !== "ERR_ASSERTION") return false;
  const stack = err.stack ?? "";
  return /undici[\\/]lib[\\/]dispatcher[\\/]client-h1\.js/.test(stack) && /Parser\.finish/.test(stack);
}

export interface CrashGuardOptions {
  log?: (line: string) => void;
  exit?: (code: number) => void;
}

/** Build the `uncaughtException` listener; exported so it can be tested without a process. */
export function createUncaughtExceptionHandler(options: CrashGuardOptions = {}): (err: unknown) => void {
  const log = options.log ?? ((line: string) => console.error(line));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let suppressed = 0;
  return (err: unknown) => {
    if (isUndiciParserAssertion(err)) {
      suppressed += 1;
      log(
        JSON.stringify({
          level: "warn",
          event: "undici_parser_assertion_suppressed",
          count: suppressed,
          message: "Upstream closed a paused connection; undici assertion ignored, server still running",
        }),
      );
      return;
    }
    log(`Uncaught exception, exiting: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    exit(1);
  };
}

export function installCrashGuard(options: CrashGuardOptions = {}): void {
  process.on("uncaughtException", createUncaughtExceptionHandler(options));
}
