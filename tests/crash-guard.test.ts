import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { createUncaughtExceptionHandler, isUndiciParserAssertion } from "../src/lib/crash-guard.js";

/** The error Railway logged on 2026-11-21, rebuilt with the same code and stack frames. */
function undiciAssertion(): Error {
  let err: Error;
  try {
    assert(false);
    throw new Error("unreachable");
  } catch (e) {
    err = e as Error;
  }
  err.stack = [
    "AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:",
    "",
    "  assert(!this.paused)",
    "",
    "    at Parser.finish (/app/node_modules/undici/lib/dispatcher/client-h1.js:374:5)",
    "    at TLSSocket.onHttpSocketEnd (/app/node_modules/undici/lib/dispatcher/client-h1.js:959:30)",
    "    at TLSSocket.emit (node:events:536:35)",
    "    at endReadableNT (node:internal/streams/readable:1698:12)",
  ].join("\n");
  return err;
}

describe("isUndiciParserAssertion", () => {
  it("matches the undici Parser.finish assertion", () => {
    expect(isUndiciParserAssertion(undiciAssertion())).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isUndiciParserAssertion(new Error("boom"))).toBe(false);
    expect(isUndiciParserAssertion("ERR_ASSERTION")).toBe(false);
    expect(isUndiciParserAssertion(undefined)).toBe(false);
    let own: unknown;
    try {
      assert(false);
    } catch (e) {
      own = e; // an assertion from our own code: right code, wrong stack
    }
    expect(isUndiciParserAssertion(own)).toBe(false);
    const elsewhere = undiciAssertion();
    elsewhere.stack = elsewhere.stack?.replace("Parser.finish", "Parser.execute");
    expect(isUndiciParserAssertion(elsewhere)).toBe(false);
  });
});

describe("createUncaughtExceptionHandler", () => {
  it("logs and keeps running for the undici assertion", () => {
    const lines: string[] = [];
    const exits: number[] = [];
    const handler = createUncaughtExceptionHandler({ log: (l) => lines.push(l), exit: (c) => exits.push(c) });
    handler(undiciAssertion());
    handler(undiciAssertion());
    expect(exits).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ event: "undici_parser_assertion_suppressed", count: 2 });
  });

  it("exits with code 1 for anything else", () => {
    const lines: string[] = [];
    const exits: number[] = [];
    const handler = createUncaughtExceptionHandler({ log: (l) => lines.push(l), exit: (c) => exits.push(c) });
    handler(new Error("boom"));
    expect(exits).toEqual([1]);
    expect(lines[0]).toContain("boom");
  });
});
