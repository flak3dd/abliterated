/** Structured multi-agent message bus → .ablit/agent-bus.jsonl */

export const AGENT_BUS_PATH = ".ablit/agent-bus.jsonl";

export type BusEventType = "assign" | "status" | "handoff" | "escalate" | "critique" | "heartbeat";

export type BusEvent = {
  ts: number;
  type: BusEventType;
  from: string;
  to?: string;
  taskId?: string;
  fleetId?: string;
  payload?: Record<string, unknown>;
};

export function formatBusEvent(ev: BusEvent): string {
  return `${JSON.stringify({ ...ev, ts: ev.ts || Date.now() })}\n`;
}

export function parseBusLines(raw: string): BusEvent[] {
  const out: BusEvent[] = [];
  for (const line of (raw || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as BusEvent;
      if (o && typeof o === "object" && o.type) out.push(o);
    } catch {
      /* skip */
    }
  }
  return out;
}
