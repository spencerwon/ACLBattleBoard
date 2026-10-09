// Records one anonymous visitor per device: a random device ID made in their browser,
// plus the name and ranking code they chose to put on their board. No IP addresses are stored.
// Test runs (deploy previews, local copies, test-named boards, demo codes) are kept apart.
import { getStore } from "@netlify/blobs";

const LIVE_HOSTS = new Set(["acl2026battleboard.netlify.app", "spencerwon.github.io"]);
const ALLOWED_ORIGINS = new Set(["https://acl2026battleboard.netlify.app", "https://spencerwon.github.io"]);
export const TEST_WORD = /test|sample|demo|dummy|fake|placeholder|asdf|qwer/i;

const clip = (s, n) => String(s ?? "").slice(0, n);
const cors = (origin) => ALLOWED_ORIGINS.has(origin) ? { "access-control-allow-origin": origin, "vary": "origin" } : {};

// Coarse device label from the browser's User-Agent, e.g. "iPhone · Safari". The raw User-Agent is never stored.
export function deviceLabel(ua = "") {
  const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua)) ? "iPad"
    : /iPhone|iPod/.test(ua) ? "iPhone"
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet")
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "Other";
  return `${os} · ${br}`;
}

// Pure core so it can be tested without Netlify: returns [status, body].
export async function record(body, { store, now = Date.now(), origin = "", ua = "" }) {
  const db = () => (typeof store === "function" ? store() : store); // opened only when something is saved
  let b;
  try { b = typeof body === "string" ? JSON.parse(body) : body; } catch { return [400, "bad json"]; }
  if (!b || !/^d_[A-Za-z0-9]{10,40}$/.test(b.d || "")) return [400, "bad id"];
  const host = clip(b.host, 80);
  const fromLive = LIVE_HOSTS.has(host) && (!origin || ALLOWED_ORIGINS.has(origin));
  if (!fromLive) return [204, ""]; // deploy previews, localhost, file copies: never counted
  const code = typeof b.c === "string" && b.c.startsWith("ACL26.") && b.c.length < 30000 ? b.c : "";
  let bid = "";
  if (code) { try { bid = clip(JSON.parse(Buffer.from(code.slice(6).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).b, 80); } catch { /* keep going without it */ } }
  if (/^sample-/.test(bid)) return [204, ""]; // made-up demo boards from ACL Wrapped
  const name = clip(b.n, 60).trim();
  const st = db();
  const prev = (await st.get(b.d, { type: "json" })) || null;
  const rec = {
    d: b.d,
    first: prev?.first || now,
    last: now,
    name: name || prev?.name || "",
    bid: bid || prev?.bid || "",
    code: code || prev?.code || "",
    rated: Math.max(0, Math.min(500, +b.r || 0)),
    battles: Math.max(0, Math.min(100000, +b.bt || 0)),
    host,
    visits: (prev?.visits || 0) + (b.v ? 1 : 0),
    device: ua ? deviceLabel(ua) : prev?.device || "",
  };
  rec.test = TEST_WORD.test(rec.name) || TEST_WORD.test(rec.bid);
  await st.setJSON(b.d, rec);
  return [204, ""];
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors(origin), "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const text = await req.text();
  if (text.length > 40000) return new Response("too big", { status: 413 });
  const [status, msg] = await record(text, { store: () => getStore({ name: "aclusers", consistency: "strong" }), origin, ua: req.headers.get("user-agent") || "" });
  return new Response(status === 204 ? null : msg, { status, headers: cors(origin) }); // a 204 must have no body
};

export const config = { path: "/api/ping" };
