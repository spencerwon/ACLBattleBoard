// Private read-out for the stats page. Only answers when the request carries Spencer's stats key.
// The key itself is never stored here, only its SHA-256 fingerprint.
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const KEY_SHA256 = "41994d33c90131c3fb4832f5a33243663c15542be81dbe7bd4566938bb4d4553";

export function keyOk(key) {
  if (typeof key !== "string" || !key) return false;
  const a = Buffer.from(createHash("sha256").update(key).digest("hex"));
  const b = Buffer.from(KEY_SHA256);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readAll(store) {
  const keys = [];
  let page = await store.list();
  keys.push(...page.blobs.map((x) => x.key));
  const users = [];
  for (let i = 0; i < keys.length; i += 25) {
    const got = await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" }).catch(() => null)));
    users.push(...got.filter(Boolean));
  }
  return users;
}

export default async (req) => {
  if (!keyOk(req.headers.get("x-stats-key"))) return new Response(JSON.stringify({ error: "key" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const users = await readAll(getStore({ name: "aclusers", consistency: "strong" }));
  return new Response(JSON.stringify({ now: Date.now(), users }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config = { path: "/api/stats" };
