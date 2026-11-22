import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Loading cheerio loads the `undici` package, which becomes the dispatcher behind
// Node's built-in fetch, exactly as in the running server.
import "cheerio";
import { discardBody } from "../src/lib/discard-body.js";

/**
 * Regression test for the 2026-11-21 outage. The local server answers the way the
 * failing upstream did: an error status, `Connection: close`, and a body large
 * enough (about 65-130 KB) to pause the HTTP parser when nobody reads it. With
 * undici 6 or 7 the peer closing then throws `assert(!this.paused)` from a socket
 * event; as an uncaught exception, that fails this test run.
 */
const BODY = Buffer.alloc(70_000, 97);
let server: net.Server;
let url: string;

beforeAll(async () => {
  server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", () => {
      const head =
        "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html\r\n" +
        `Content-Length: ${BODY.length}\r\nConnection: close\r\n\r\n`;
      socket.end(Buffer.concat([Buffer.from(head), BODY]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("error responses whose body is not read", () => {
  it("do not crash the process when the body is discarded", async () => {
    const response = await fetch(url);
    expect(response.status).toBe(503);
    await discardBody(response);
    await settle();
  });

  it("do not crash the process even when the body is left unread", async () => {
    // Covers fetch calls outside this repo (the drug-data engine): relies on the
    // undici 8 override, so it fails if that override is dropped.
    const response = await fetch(url);
    expect(response.status).toBe(503);
    await settle();
  });

  it("discardBody tolerates a body that was already read", async () => {
    const response = new Response("done");
    await response.text();
    await expect(discardBody(response)).resolves.toBeUndefined();
  });
});
