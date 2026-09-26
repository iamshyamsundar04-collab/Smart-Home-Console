// MCP client: real Streamable HTTP JSON-RPC 2.0 or deterministic mock fallback.

export type Devices = {
  front_door_lock: "locked" | "unlocked";
  living_room_lights: number; // brightness %
  porch_light: "on" | "off";
  thermostat: number; // °F
  garage_door: "open" | "closed";
};

export type Reminder = { id: string; description: string; assigned_to: string; trigger_time: string };

export type TraceEntry = {
  id: string;
  ts: number;
  method: string;
  tool?: string | undefined;
  params: unknown;
  response: unknown;
  latency: number;
  status: "ok" | "error";
  mode: "mock" | "live";
  sessionId?: string | undefined;
};

export const initialDevices: Devices = {
  front_door_lock: "unlocked",
  living_room_lights: 80,
  porch_light: "off",
  thermostat: 70,
  garage_door: "closed",
};

const TOOLS = [
  { name: "get_household_digest", description: "Natural language summary of household activity, alerts, packages and device status.", inputSchema: { type: "object", properties: { timeframe_hours: { type: "number" }, include_alerts_only: { type: "boolean" } } } },
  { name: "query_security_events", description: "Query Ring doorbell rings, motion events, or door lock logs.", inputSchema: { type: "object", properties: { event_type: { type: "string", enum: ["motion", "doorbell_ring", "access_denied", "all"] }, max_results: { type: "number" } } } },
  { name: "execute_device_action", description: "Control smart locks, lighting, or climate.", inputSchema: { type: "object", properties: { target_entity: { type: "string" }, action: { type: "string" }, value: { type: ["string", "number"] } }, required: ["target_entity", "action"] } },
  { name: "schedule_family_reminder", description: "Schedule a family reminder announced on speakers and displays.", inputSchema: { type: "object", properties: { description: { type: "string" }, assigned_to: { type: "string" }, trigger_time: { type: "string" } }, required: ["description", "trigger_time"] } },
];

type Ctx = { devices: Devices; reminders: Reminder[] };
const text = (t: string, structured?: unknown) => ({ content: [{ type: "text", text: t }], structuredContent: structured, isError: false });

function mockHandle(method: string, params: any, ctx: Ctx): { result: any; ctx: Ctx } {
  if (method === "initialize")
    return { ctx, result: { protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "alexa-household-mcp (mock)", version: "1.0.0" } } };
  if (method === "tools/list") return { ctx, result: { tools: TOOLS } };
  if (method !== "tools/call") throw new Error(`Method not found: ${method}`);
  const { name, arguments: a = {} } = params;
  const d = ctx.devices;
  switch (name) {
    case "get_household_digest": {
      const s = { timeframe_hours: a.timeframe_hours ?? 4, packages: [{ carrier: "Amazon", item: "1 package", location: "front porch", at: "14:12" }], alerts: d.front_door_lock === "unlocked" ? ["Front door has been unlocked for 2h 14m"] : [], devices: d, occupancy: "Maya home since 15:40; Raj away" };
      return { ctx, result: text(`In the last ${s.timeframe_hours}h: 1 Amazon package delivered to the front porch at 2:12 PM. Maya arrived home at 3:40 PM. ${s.alerts.length ? s.alerts[0] + "." : "No active alerts."} Thermostat at ${d.thermostat}°F, living room lights at ${d.living_room_lights}%.`, s) };
    }
    case "query_security_events": {
      const all = [
        { type: "doorbell_ring", at: "14:12", camera: "Front Door Ring", detail: "Delivery driver, left package, no answer" },
        { type: "motion", at: "13:47", camera: "Driveway", detail: "Person detected, walked past" },
        { type: "doorbell_ring", at: "11:05", camera: "Front Door Ring", detail: "Neighbor (recognized face: Linda)" },
        { type: "access_denied", at: "09:31", camera: "Front Door Lock", detail: "Wrong keypad code entered twice" },
        { type: "motion", at: "08:02", camera: "Backyard", detail: "Animal (cat) detected" },
      ];
      const t = a.event_type ?? "all";
      const events = all.filter((e) => t === "all" || e.type === t).slice(0, a.max_results ?? 5);
      return { ctx, result: text(`${events.length} event(s): ` + events.map((e) => `${e.at} ${e.type} @ ${e.camera} — ${e.detail}`).join("; "), { events }) };
    }
    case "execute_device_action": {
      const nd = { ...d };
      const ent = String(a.target_entity);
      const act = String(a.action);
      if (ent.includes("lock")) nd.front_door_lock = act === "unlock" ? "unlocked" : "locked";
      else if (ent.includes("porch")) nd.porch_light = act === "turn_off" ? "off" : "on";
      else if (ent.includes("garage")) nd.garage_door = act === "open" ? "open" : "closed";
      else if (ent.includes("thermostat")) nd.thermostat = Number(a.value ?? nd.thermostat);
      else if (ent.includes("light")) nd.living_room_lights = act === "turn_off" ? 0 : act === "turn_on" && a.value == null ? 100 : parseInt(String(a.value ?? "30"), 10);
      else return { ctx, result: { ...text(`Unknown device: ${ent}`), isError: true } };
      return { ctx: { ...ctx, devices: nd }, result: text(`OK: ${ent} → ${act}${a.value != null ? ` (${a.value})` : ""}`, { target_entity: ent, action: act, new_state: nd }) };
    }
    case "schedule_family_reminder": {
      const r: Reminder = { id: "rem_" + Math.random().toString(36).slice(2, 8), description: a.description, assigned_to: a.assigned_to ?? "Household", trigger_time: a.trigger_time };
      return { ctx: { ...ctx, reminders: [...ctx.reminders, r] }, result: text(`Reminder scheduled for ${r.assigned_to} at ${r.trigger_time}: "${r.description}"`, r) };
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}

export class McpClient {
  sessionId?: string;
  private rpcId = 0;
  constructor(public url: string | null, public ctx: Ctx, private onTrace: (t: TraceEntry) => void) {}

  async request(method: string, params: any = {}): Promise<any> {
    const id = ++this.rpcId;
    const body = { jsonrpc: "2.0", id, method, params };
    const t0 = performance.now();
    const tool = method === "tools/call" ? params.name : undefined;
    const trace = (response: unknown, status: "ok" | "error") =>
      this.onTrace({ id: crypto.randomUUID(), ts: Date.now(), method, tool, params: body, response, latency: Math.round(performance.now() - t0), status, mode: this.url ? "live" : "mock", sessionId: this.sessionId });

    if (!this.url) {
      await new Promise((r) => setTimeout(r, 90 + Math.random() * 220));
      if (!this.sessionId) this.sessionId = crypto.randomUUID();
      try {
        const { result, ctx } = mockHandle(method, params, this.ctx);
        this.ctx = ctx;
        const resp = { jsonrpc: "2.0", id, result };
        trace(resp, "ok");
        return result;
      } catch (e: any) {
        const resp = { jsonrpc: "2.0", id, error: { code: -32601, message: e.message } };
        trace(resp, "error");
        throw e;
      }
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" };
      if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
      const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
      const ct = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      let json: any;
      if (ct.includes("text/event-stream")) {
        const datas = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        json = JSON.parse(datas[datas.length - 1] ?? "{}");
      } else json = raw ? JSON.parse(raw) : {};
      if (json.error || !res.ok) {
        trace(json, "error");
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      trace(json, "ok");
      return json.result;
    } catch (e: any) {
      if (!(e instanceof Error && e.message.startsWith("HTTP"))) trace({ error: String(e?.message ?? e) }, "error");
      throw e;
    }
  }

  async notify(method: string) {
    if (!this.url) return;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    await fetch(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method }) }).catch(() => {});
  }
}

// ---------- Tiny deterministic "Alexa+" planner ----------
export type Call = { name: string; arguments: Record<string, unknown> };

export function plan(input: string): Call[] {
  const q = input.toLowerCase();
  const calls: Call[] = [];
  if (/remind/.test(q)) {
    const time = q.match(/at (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/)?.[1] ?? q.match(/in \d+ (?:minutes|hours?)/)?.[0] ?? "18:00";
    const who = input.match(/remind (\w+)/i)?.[1];
    const assigned = who && !/^me$/i.test(who) ? who : "Me";
    const desc = input.replace(/.*?remind \w+ (to )?/i, "").replace(/\s*(at|in) .+$/i, "").trim() || input;
    calls.push({ name: "schedule_family_reminder", arguments: { description: desc, assigned_to: assigned, trigger_time: time } });
  }
  if (/\b(lock|unlock)\b/.test(q)) calls.push({ name: "execute_device_action", arguments: { target_entity: "front_door_lock", action: /unlock/.test(q) ? "unlock" : "lock" } });
  if (/garage/.test(q)) calls.push({ name: "execute_device_action", arguments: { target_entity: "garage_door", action: /open/.test(q) ? "open" : "close" } });
  if (/porch/.test(q)) calls.push({ name: "execute_device_action", arguments: { target_entity: "porch_light", action: /off/.test(q) ? "turn_off" : "turn_on" } });
  if (/(living room|lights?)/.test(q) && !/porch/.test(q) && /(dim|bright|off|on|light)/.test(q) && !/what|going on/.test(q)) {
    const pct = q.match(/(\d{1,3})\s*%/)?.[1];
    const action = /\boff\b/.test(q) ? "turn_off" : "set_brightness";
    calls.push({ name: "execute_device_action", arguments: { target_entity: "living_room_lights", action, ...(action === "set_brightness" ? { value: pct ? `${pct}%` : /dim/.test(q) ? "30%" : "100%" } : {}) } });
  }
  const temp = q.match(/(\d{2})\s*(?:°|degrees)/)?.[1];
  if (temp || /warmer|cooler|thermostat/.test(q)) calls.push({ name: "execute_device_action", arguments: { target_entity: "thermostat", action: "set_temperature", value: Number(temp ?? (/warmer/.test(q) ? 73 : 68)) } });
  if (/(door|ring|someone|anyone|motion|security|camera|visitor)/.test(q) && !calls.some((c) => c.name === "execute_device_action" && String(c.arguments["target_entity"]).includes("lock")))
    calls.push({ name: "query_security_events", arguments: { event_type: /motion/.test(q) ? "motion" : /(ring|door|came|visitor)/.test(q) ? "doorbell_ring" : "all", max_results: 5 } });
  if (!calls.length || /(going on|digest|summary|update|house|home|package)/.test(q) && !calls.length) calls.push({ name: "get_household_digest", arguments: { timeframe_hours: 4 } });
  return calls;
}

export function compose(results: { call: Call; result: any; error?: string }[]): string {
  const parts = results.map(({ call, result, error }) => {
    if (error) return `I couldn't reach ${call.name.replace(/_/g, " ")} — ${error}.`;
    const s = result?.structuredContent;
    const t = result?.content?.[0]?.text ?? "";
    switch (call.name) {
      case "get_household_digest":
        return t ? `Here's what's happening at home. ${t.replace(/^In the last \d+h: /, "")}` : "Everything looks calm at home.";
      case "query_security_events": {
        const ev = s?.events as any[] | undefined;
        if (!ev) return t;
        if (!ev.length) return "No one came by — all quiet.";
        return `Yes — ${ev.length === 1 ? "one visit" : `${ev.length} events`}. ` + ev.slice(0, 3).map((e) => `At ${e.at}, ${e.detail.charAt(0).toLowerCase() + e.detail.slice(1)}`).join(". ") + ".";
      }
      case "execute_device_action": {
        const a = call.arguments;
        const ent = String(a["target_entity"]).replace(/_/g, " ");
        if (a["action"] === "lock") return "Front door is locked.";
        if (a["action"] === "unlock") return "Front door is unlocked.";
        if (a["action"] === "set_temperature") return `Thermostat set to ${a["value"]}°.`;
        if (a["action"] === "set_brightness") return `Dimmed the ${ent} to ${a["value"]}.`;
        return `Done — ${ent} ${String(a["action"]).replace(/_/g, " ")}.`;
      }
      case "schedule_family_reminder": {
        const a = call.arguments;
        return `Got it. I'll remind ${a["assigned_to"] === "Me" ? "you" : a["assigned_to"]} to ${a["description"]} at ${a["trigger_time"]}.`;
      }
    }
    return t;
  });
  return parts.join(" ");
}
