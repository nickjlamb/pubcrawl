/**
 * Anonymous connection counting for the hosted HTTP server.
 *
 * Every MCP connection starts with an `initialize` request carrying the client's
 * self-reported name and version (e.g. "claude-ai", "claude-code", "cursor").
 * We log one structured line per initialize with a running count for the UTC day,
 * so daily connections per client can be read straight from the host's logs.
 *
 * This counts sessions, not people: one person can open many sessions, and hosted
 * clients such as Claude.ai connect from shared IPs. Nothing about the user, their
 * IP or their queries is recorded. Counts live in memory and reset on restart;
 * the log lines are the durable record.
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

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(name: unknown, version: unknown): InitializeEvent {
    const day = this.now().toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.total = 0;
      this.perClient.clear();
    }
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
}
