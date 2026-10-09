// Netlify Function: /api/board — stores ACL Battle Boards in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { handle } from "./board-core.mjs";

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export default async (req) => {
  try {
    const store = getStore({ name: "boards", consistency: "strong" });
    const url = new URL(req.url);
    let body = {};
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 200000) return json(413, { error: "Request too large." });
      try { body = JSON.parse(text || "{}"); } catch { return json(400, { error: "Bad request." }); }
    }
    const out = await handle(store, { method: req.method, query: Object.fromEntries(url.searchParams), body });
    return json(200, out);
  } catch (e) {
    return json(e.status || 500, { error: e.status ? e.message : "Something went wrong. Try again." });
  }
};

export const config = { path: "/api/board" };
