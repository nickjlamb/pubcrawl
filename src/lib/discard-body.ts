/**
 * Release a response whose body will not be read (an error status we are about
 * to throw for).
 *
 * Leaving the body unread is what took the hosted server down on 2026-11-21:
 * when an upstream answers with `Connection: close` and a body of roughly
 * 65-130 KB that nobody reads, undici 6 and 7 pause the parser on backpressure,
 * then hit `assert(!this.paused)` when the peer closes. That assertion is thrown
 * from a socket event, so it cannot be caught and it ends the process.
 * Cancelling the body closes the connection before that can happen.
 */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed, locked or errored: nothing left to release.
  }
}
