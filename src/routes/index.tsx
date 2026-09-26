import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Lock, LockOpen, Lightbulb, Thermometer, Bell, Send, Settings, Activity, Warehouse, Lamp, ChevronRight, Radio, Trash2 } from "lucide-react";
import { McpClient, initialDevices, plan, compose, type Devices, type Reminder, type TraceEntry } from "@/lib/mcp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alexa+ MCP Testbed — Live Household Assistant Demo" },
      { name: "description", content: "Simulated Alexa+ assistant with a live MCP JSON-RPC trace viewer and smart-home device dashboard." },
      { property: "og:title", content: "Alexa+ MCP Testbed" },
      { property: "og:description", content: "Watch Alexa+ converse while calling MCP tools over Streamable HTTP in real time." },
    ],
  }),
  component: App,
});

type Msg = { role: "user" | "assistant"; text: string; tools?: string[] };
const SUGGESTIONS = ["What's going on around the house?", "Did anyone come to the door while I was out?", "Lock the front door and dim the living room lights", "Remind me to take out the trash at 7pm"];

function App() {
  const [devices, setDevices] = useState<Devices>(initialDevices);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: "Hi Shyam — I'm connected to your household MCP server. Ask me about home, security, devices, or reminders." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const client = useRef<McpClient | null>(null);
  const initialized = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  const addTrace = (t: TraceEntry) => { setTraces((p) => [t, ...p]); setSelected(t.id); };

  const reset = (u: string) => {
    client.current = new McpClient(u.trim() || null, { devices, reminders }, addTrace);
    initialized.current = false;
  };
  useEffect(() => { reset(""); }, []);
  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function ensureInit(c: McpClient) {
    if (initialized.current) return;
    await c.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "alexa-plus-testbed", version: "1.0.0" } });
    await c.notify("notifications/initialized");
    await c.request("tools/list");
    initialized.current = true;
  }

  async function send(text: string) {
    if (!text.trim() || busy || !client.current) return;
    const c = client.current;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    const results: { call: any; result: any; error?: string }[] = [];
    try {
      await ensureInit(c);
      for (const call of plan(text)) {
        try {
          const result = await c.request("tools/call", call);
          results.push({ call, result });
          if (call.name === "execute_device_action") {
            const ns = result?.structuredContent?.new_state;
            if (ns) setDevices(ns); else if (c.url) applyLocal(call.arguments);
            setFlash(String(call.arguments["target_entity"]));
          }
          if (call.name === "schedule_family_reminder") {
            const r = result?.structuredContent;
            setReminders((p) => [...p, r?.id ? r : { id: crypto.randomUUID(), ...(call.arguments as any) }]);
            setFlash("reminders");
          }
        } catch (e: any) { results.push({ call, result: null, error: e.message }); }
      }
      setMsgs((m) => [...m, { role: "assistant", text: compose(results), tools: results.map((r) => r.call.name) }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: `I couldn't connect to the MCP server (${e.message}). Check the server URL in settings.` }]);
    } finally { setBusy(false); setTimeout(() => setFlash(null), 1400); }
  }

  function applyLocal(a: Record<string, unknown>) {
    setDevices((d) => {
      const n = { ...d }; const e = String(a["target_entity"]); const act = String(a["action"]);
      if (e.includes("lock")) n.front_door_lock = act === "unlock" ? "unlocked" : "locked";
      else if (e.includes("thermostat")) n.thermostat = Number(a["value"]);
      else if (e.includes("porch")) n.porch_light = act === "turn_off" ? "off" : "on";
      else if (e.includes("garage")) n.garage_door = act === "open" ? "open" : "closed";
      else if (e.includes("light")) n.living_room_lights = act === "turn_off" ? 0 : parseInt(String(a["value"] ?? "100"), 10);
      return n;
    });
  }

  const live = !!client.current?.url;
  const sel = traces.find((t) => t.id === selected);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="relative grid size-9 place-items-center rounded-full bg-primary/15">
            <div className={`size-4 rounded-full bg-primary ${busy ? "animate-ping" : ""}`} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Alexa+ <span className="text-muted-foreground font-normal">MCP Testbed</span></h1>
            <p className="font-mono text-[11px] text-muted-foreground">Streamable HTTP · spec 2025-11-25</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs ${live ? "text-success" : "text-warning"}`}>
            <Radio className="size-3.5" /> {live ? "LIVE" : "MOCK"} {client.current?.sessionId && <span className="text-muted-foreground">· {client.current.sessionId.slice(0, 8)}</span>}
          </span>
          <button onClick={() => setShowSettings((s) => !s)} className="rounded-lg border p-2 hover:bg-muted"><Settings className="size-4" /></button>
        </div>
      </header>

      {showSettings && (
        <div className="flex items-end gap-3 border-b bg-panel px-6 py-4">
          <label className="flex-1">
            <span className="text-xs text-muted-foreground">MCP server URL (leave empty for built-in mock)</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3000/mcp" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
          </label>
          <button onClick={() => { reset(url); setShowSettings(false); setTraces([]); }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Connect</button>
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[1.1fr_1.2fr_0.8fr] gap-4 p-4">
        {/* Chat */}
        <section className="flex min-h-0 flex-col rounded-2xl border bg-panel">
          <PaneTitle icon={<div className="size-2 rounded-full bg-primary" />} title="Conversation" />
          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-5">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">{m.text}</div>
                ) : (
                  <div className="max-w-[92%]">
                    <p className="text-[15px] leading-relaxed">{m.text}</p>
                    {m.tools && <div className="mt-2 flex flex-wrap gap-1.5">{m.tools.map((t, j) => <span key={j} className="rounded-md bg-violet/15 px-2 py-0.5 font-mono text-[11px] text-violet">⚙ {t}</span>)}</div>}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="flex gap-1.5 py-2">{[0, 1, 2].map((i) => <span key={i} className="size-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 120}ms` }} />)}</div>}
            <div ref={chatEnd} />
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {SUGGESTIONS.map((s) => <button key={s} disabled={busy} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40">{s}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="m-4 mt-0 flex items-center gap-2 rounded-xl border bg-background p-1.5 focus-within:border-primary">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Alexa…" className="flex-1 bg-transparent px-3 py-2 text-sm outline-none" />
            <button disabled={busy || !input.trim()} className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"><Send className="size-4" /></button>
          </form>
        </section>

        {/* Trace */}
        <section className="flex min-h-0 flex-col rounded-2xl border bg-panel">
          <PaneTitle icon={<Activity className="size-4 text-violet" />} title="MCP JSON-RPC Trace" right={<span className="flex items-center gap-3 font-mono text-xs text-muted-foreground">{traces.length} calls {traces.length > 0 && <button onClick={() => setTraces([])} className="hover:text-foreground"><Trash2 className="size-3.5" /></button>}</span>} />
          <div className="scrollbar-thin max-h-[42%] overflow-y-auto border-b">
            {traces.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Send a message to see protocol traffic.</p>}
            {traces.map((t) => (
              <button key={t.id} onClick={() => setSelected(t.id)} className={`flex w-full items-center gap-3 border-b px-4 py-2 text-left font-mono text-xs animate-in fade-in slide-in-from-top-1 ${selected === t.id ? "bg-muted" : "hover:bg-muted/50"}`}>
                <span className={`size-1.5 rounded-full ${t.status === "ok" ? "bg-success" : "bg-destructive"}`} />
                <span className="w-16 text-muted-foreground">{new Date(t.ts).toLocaleTimeString([], { hour12: false })}</span>
                <span className={t.method === "tools/call" ? "text-primary" : "text-violet"}>{t.method}</span>
                {t.tool && <span className="truncate text-foreground">{t.tool}</span>}
                <span className="ml-auto text-muted-foreground">{t.latency}ms</span>
                <ChevronRight className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
          <div className="scrollbar-thin grid min-h-0 flex-1 grid-rows-2 overflow-hidden">
            <JsonBlock label="→ Request" data={sel?.params} extra={sel && `POST · Accept: application/json, text/event-stream${sel.sessionId ? ` · mcp-session-id: ${sel.sessionId.slice(0, 8)}…` : ""}`} />
            <JsonBlock label="← Response" data={sel?.response} extra={sel && `${sel.status.toUpperCase()} · ${sel.latency}ms · ${sel.mode}`} />
          </div>
        </section>

        {/* Devices */}
        <section className="scrollbar-thin flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="rounded-2xl border bg-panel"><PaneTitle icon={<Lamp className="size-4 text-warning" />} title="Home" /></div>
          <DeviceCard flash={flash?.includes("lock")} icon={devices.front_door_lock === "locked" ? <Lock /> : <LockOpen />} name="Front Door" value={devices.front_door_lock === "locked" ? "Locked" : "Unlocked"} tone={devices.front_door_lock === "locked" ? "success" : "destructive"} />
          <DeviceCard flash={flash === "living_room_lights"} icon={<Lightbulb />} name="Living Room Lights" value={devices.living_room_lights ? `${devices.living_room_lights}%` : "Off"} tone="warning" bar={devices.living_room_lights} />
          <DeviceCard flash={flash === "thermostat"} icon={<Thermometer />} name="Thermostat" value={`${devices.thermostat}°F`} tone="primary" />
          <DeviceCard flash={flash === "porch_light"} icon={<Lamp />} name="Porch Light" value={devices.porch_light === "on" ? "On" : "Off"} tone={devices.porch_light === "on" ? "warning" : "muted"} />
          <DeviceCard flash={flash === "garage_door"} icon={<Warehouse />} name="Garage" value={devices.garage_door === "open" ? "Open" : "Closed"} tone={devices.garage_door === "open" ? "destructive" : "success"} />
          <div className={`rounded-2xl border bg-panel p-4 transition-all ${flash === "reminders" ? "border-primary shadow-[0_0_30px_-5px_var(--color-primary)]" : ""}`}>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Bell className="size-4 text-violet" /> Reminders <span className="ml-auto font-mono text-xs text-muted-foreground">{reminders.length}</span></div>
            {reminders.length === 0 ? <p className="text-xs text-muted-foreground">No reminders scheduled.</p> : (
              <ul className="space-y-2">{reminders.map((r) => (
                <li key={r.id} className="rounded-lg bg-muted/60 px-3 py-2 animate-in fade-in">
                  <p className="text-sm">{r.description}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{r.assigned_to} · {r.trigger_time}</p>
                </li>))}</ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function PaneTitle({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">{icon}{title}<div className="ml-auto">{right}</div></div>;
}

function JsonBlock({ label, data, extra }: { label: string; data: unknown; extra?: string | undefined }) {
  return (
    <div className="flex min-h-0 flex-col border-b last:border-b-0">
      <div className="flex items-center justify-between px-4 py-2 font-mono text-[11px] text-muted-foreground"><span className="text-foreground">{label}</span><span className="truncate pl-3">{extra}</span></div>
      <pre className="scrollbar-thin flex-1 overflow-auto px-4 pb-3 font-mono text-[11.5px] leading-relaxed text-primary/90">{data ? JSON.stringify(data, null, 2) : "—"}</pre>
    </div>
  );
}

const toneCls: Record<string, string> = { success: "text-success bg-success/15", destructive: "text-destructive bg-destructive/15", warning: "text-warning bg-warning/15", primary: "text-primary bg-primary/15", muted: "text-muted-foreground bg-muted" };

function DeviceCard({ icon, name, value, tone, bar, flash }: { icon: React.ReactNode; name: string; value: string; tone: string; bar?: number; flash?: boolean | undefined }) {
  return (
    <div className={`rounded-2xl border bg-panel p-4 transition-all duration-500 ${flash ? "scale-[1.02] border-primary shadow-[0_0_30px_-5px_var(--color-primary)]" : ""}`}>
      <div className="flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-xl [&_svg]:size-5 ${toneCls[tone]}`}>{icon}</div>
        <div className="flex-1"><p className="text-xs text-muted-foreground">{name}</p><p className="text-lg font-semibold">{value}</p></div>
      </div>
      {bar !== undefined && <div className="mt-3 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-warning transition-all duration-700" style={{ width: `${bar}%` }} /></div>}
    </div>
  );
}
