/**
 * Distinct visitors per UTC day, counted without keeping anything that identifies one.
 *
 * Each connection's network address is turned into a short keyed hash and added to an
 * in-memory set; only the size of the set is ever reported. The key is random, lives
 * only in this process, and is replaced at every UTC midnight and every restart, so a
 * hash cannot be reversed by trying addresses, compared across days, or compared with
 * another instance. No address and no hash is logged or written to disk.
 *
 * The result is a floor, not a headcount: hosted clients such as the Claude apps
 * connect from their provider's servers, and an office or VPN shares one address, so
 * many people can count as one. An address behind a proxy is taken from headers the
 * proxy sets, which a client talking to the server directly could set itself; that
 * can only inflate a count.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

/** Upper bound on remembered visitors per day, so memory stays small whatever arrives. */
export const MAX_VISITORS_PER_DAY = 50_000;

/**
 * Reduce an address to what identifies a visitor: an IPv4 address as it is, an
 * IPv4-mapped IPv6 address as its IPv4 part, and any other IPv6 address as its /64
 * network, because devices change the rest of the address frequently.
 */
export function normaliseAddress(raw: string): string | null {
  let address = raw.trim().toLowerCase();
  if (address.startsWith("[")) address = address.slice(1, address.indexOf("]") === -1 ? undefined : address.indexOf("]"));
  const zone = address.indexOf("%");
  if (zone !== -1) address = address.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) address = mapped[1];
  const kind = isIP(address);
  if (kind === 4) return address;
  if (kind !== 6) return null;
  // Expand "::" so the first four groups are the network.
  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups];
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":") + "::/64";
}

/**
 * The visitor's address for one request: what the proxy in front reports
 * (`X-Real-IP`, else the last `X-Forwarded-For` entry, which is the one the nearest
 * proxy added), else the socket's own peer address. Null when none is usable.
 */
export function addressFromRequest(req: Pick<IncomingMessage, "headers" | "socket">): string | null {
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[value.length - 1] : value;
  };
  const candidates = [header("x-real-ip"), header("x-forwarded-for")?.split(",").pop(), req.socket?.remoteAddress];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const address = normaliseAddress(candidate);
    if (address) return address;
  }
  return null;
}

export class VisitorCounter {
  private key: Buffer;
  private all = new Set<string>();
  private perGroup = new Map<string, Set<string>>();

  constructor(private readonly makeKey: () => Buffer = () => randomBytes(32)) {
    this.key = this.makeKey();
  }

  /** Forget everyone and take a new key. Called when the UTC day changes. */
  reset(): void {
    this.key = this.makeKey();
    this.all.clear();
    this.perGroup.clear();
  }

  /**
   * Note one visit and return the distinct counts so far. `address` may be null (it
   * is then not counted); `group` is the client name the counts are split by.
   */
  note(address: string | null, group: string): { visitors: number; visitorsForGroup: number } {
    let forGroup = this.perGroup.get(group);
    if (address !== null) {
      // 64 bits of the hash: ample to tell visitors apart, useless for anything else.
      const id = createHmac("sha256", this.key).update(address).digest("hex").slice(0, 16);
      if (this.all.has(id) || this.all.size < MAX_VISITORS_PER_DAY) {
        this.all.add(id);
        if (!forGroup) {
          forGroup = new Set();
          this.perGroup.set(group, forGroup);
        }
        forGroup.add(id);
      }
    }
    return { visitors: this.all.size, visitorsForGroup: forGroup?.size ?? 0 };
  }
}
