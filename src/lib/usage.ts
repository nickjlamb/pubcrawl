/**
 * Anonymous usage counting for the hosted HTTP server.
 *
 * Connections: every MCP connection starts with an `initialize` request carrying the
 * client's self-reported name and version (e.g. "claude-ai", "claude-code", "cursor").
 * We log one structured line per initialize with a running count for the UTC day,
 * so daily connections per client can be read straight from the host's logs.
 *
 * Tool calls: one structured line per completed tool call with the tool's name,
 * whether it succeeded, how long it took and running counts for the UTC day, so the
 * logs show which tools are used and which are failing. The server is stateless, so
 * a tool call cannot be tied to a connection or a client and no attempt is made to.
 *
 * This counts sessions and calls, not people: one person can open many sessions, and
 * hosted clients such as Claude.ai connect from shared IPs. Nothing about the user,
 * their IP, their queries or any tool argument or result is recorded. Counts live in
 * memory and reset on restart; the log lines are the durable record.
 */

export interface InitializeEvent {
  message: string;
  level: "info";
  event: "initialize";
  client: string;
  clientVersion: string;
  day: string;
  todayTotal: number;
  todayForClient: number;
}

export interface ToolCallEvent {
  message: string;
  level: "info";
  event: "tool_call";
  tool: string;
  /** False when the tool returned `isError` or threw. */
  ok: boolean;
  durationMs: number;
  day: string;
  todayToolCalls: number;
  todayForTool: number;
  todayErrorsForTool: number;
}

const MAX_LEN = 64;

/** Client names are self-reported; keep them short and log-safe. */
export function sanitizeClientField(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const cleaned = value.replace(/[^\w.@/-]/g, "_").slice(0, MAX_LEN);
  return cleaned.length > 0 ? cleaned : "unknown";
}

export class UsageCounter {
  private day = "";
  private total = 0;
  private perClient = new Map<string, number>();
  private toolCalls = 0;
  private perTool = new Map<string, { calls: number; errors: number }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Start a fresh set of counts when the UTC day changes. Returns today's date. */
  private rollDay(): string {
    const day = this.now().toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.total = 0;
      this.perClient.clear();
      this.toolCalls = 0;
      this.perTool.clear();
    }
    return day;
  }

  /**
   * Count one completed tool call. `tool` must be a registered tool's name (the
   * caller guarantees this), so the set of names in the logs stays fixed.
   */
  recordToolCall(tool: string, ok: boolean, durationMs: number): ToolCallEvent {
    const day = this.rollDay();
    this.toolCalls += 1;
    const entry = this.perTool.get(tool) ?? { calls: 0, errors: 0 };
    entry.calls += 1;
    if (!ok) entry.errors += 1;
    this.perTool.set(tool, entry);
    return {
      message: `mcp tool_call tool=${tool} ok=${ok}`,
      level: "info",
      event: "tool_call",
      tool,
      ok,
      durationMs: Math.max(0, Math.round(durationMs)),
      day,
      todayToolCalls: this.toolCalls,
      todayForTool: entry.calls,
      todayErrorsForTool: entry.errors,
    };
  }

  record(name: unknown, version: unknown): InitializeEvent {
    const day = this.rollDay();
    const client = sanitizeClientField(name);
    const clientVersion = sanitizeClientField(version);
    this.total += 1;
    const forClient = (this.perClient.get(client) ?? 0) + 1;
    this.perClient.set(client, forClient);
    return {
      message: `mcp initialize client=${client}`,
      level: "info",
      event: "initialize",
      client,
      clientVersion,
      day,
      todayTotal: this.total,
      todayForClient: forClient,
    };
  }

  /** Today's counts per client, for tests and debugging. */
  snapshot(): { day: string; total: number; clients: Record<string, number> } {
    return { day: this.day, total: this.total, clients: Object.fromEntries(this.perClient) };
  }

  /** Today's tool-call counts, for tests and debugging. */
  toolSnapshot(): { day: string; total: number; tools: Record<string, { calls: number; errors: number }> } {
    const tools: Record<string, { calls: number; errors: number }> = {};
    for (const [name, entry] of this.perTool) tools[name] = { ...entry };
    return { day: this.day, total: this.toolCalls, tools };
  }
}
