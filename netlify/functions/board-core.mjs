// Board storage logic, kept separate from Netlify so it can be tested with an in-memory store.
// Keys in the store:
//   b:<id>        -> board record {id, name, share, state, editHash, created, updated}
//   s:<share>     -> board id (share-name index; share names are public, view-only)
//   e:<editHash>  -> board id (private edit-code index; only the hash is stored)
import { createHash, randomBytes, randomInt } from "node:crypto";

const WORDS = ("disco mango tiger velvet cactus comet lemon neon river summit cobalt maple pepper rocket sunny tango "+
  "violet willow amber bongo cherry denim echo fable glitter honey indigo jungle karma lotus magic nova olive "+
  "pixel quartz radio saffron tempo ultra vinyl wave yonder zest atlas banjo cedar dune ember fiesta guitar harbor "+
  "iris jazz kite lagoon meadow nectar opal piano quill rhythm sierra thunder unity vivid whistle yellow zephyr "+
  "acorn breeze canyon daisy eagle falcon garnet hazel ivory jasper koala lilac marble nutmeg orchid peach raven "+
  "sage topaz umber vortex walnut yarrow aurora bluebonnet cosmic drift frost groove hula island juniper "+
  "lantern mosaic noodle onyx prism ripple saturn tulip velvet waltz").split(" ").filter(Boolean);
export const SHARE_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$/;
const RESERVED = new Set(["admin","api","b","board","boards","help","login","netlify","null","undefined","test","acl","settings"]);
const MAX_STATE_BYTES = 120000;

export const hash = (s) => createHash("sha256").update("acl26:" + String(s).trim().toLowerCase()).digest("hex");
export const newEditCode = () => `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}-${String(randomInt(10000)).padStart(4, "0")}`;
const newId = () => randomBytes(9).toString("base64url");
export const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 16);

function cleanState(st) {
  if (!st || typeof st !== "object") throw httpErr(400, "Missing board data.");
  const out = {
    v: 3,
    name: String(st.name || "").slice(0, 40),
    bid: String(st.bid || "").slice(0, 40),
    t: {}, o: [[], [], [], []], us: [], h: [],
  };
  const okId = (i) => Number.isInteger(i) && i >= 0 && i < 500;
  for (const k in st.t || {}) { const v = st.t[k]; if (okId(+k) && [0, 1, 2, 3].includes(v)) out.t[+k] = v; }
  (Array.isArray(st.o) ? st.o : []).slice(0, 4).forEach((l, ti) => { out.o[ti] = (Array.isArray(l) ? l : []).filter(okId).slice(0, 500); });
  out.us = (Array.isArray(st.us) ? st.us : []).filter(okId).slice(0, 500);
  out.h = (Array.isArray(st.h) ? st.h : []).filter((r) => Array.isArray(r) && okId(r[0]) && okId(r[1]) && [-1, 0, 1, 2].includes(r[2])).map((r) => [r[0], r[1], r[2]]).slice(0, 6000);
  if (JSON.stringify(out).length > MAX_STATE_BYTES) throw httpErr(413, "Board is too large.");
  return out;
}
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
const publicView = (b) => ({ name: b.name, share: b.share, updated: b.updated, state: b.state });

async function freeShare(store, wanted, name) {
  const base = SHARE_RE.test(wanted || "") && !RESERVED.has(wanted) ? wanted : (slug(name) || "acl") + "26";
  const tries = [base, ...Array.from({ length: 12 }, () => base.slice(0, 16) + randomInt(10, 100))];
  for (const s of tries) { if (SHARE_RE.test(s) && !RESERVED.has(s) && !(await store.get("s:" + s))) return s; }
  throw httpErr(409, "Couldn't find a free share name. Try another.");
}
async function boardByEdit(store, edit) {
  if (!edit) throw httpErr(401, "Missing edit code.");
  const id = await store.get("e:" + hash(edit));
  if (!id) throw httpErr(404, "That edit code doesn't match a board.");
  const b = await store.get("b:" + id, { type: "json" });
  if (!b || b.editHash !== hash(edit)) throw httpErr(404, "That edit code doesn't match a board.");
  return b;
}

export async function handle(store, { method, query = {}, body = {} }) {
  if (method === "GET") {
    const share = String(query.share || "").toLowerCase();
    if (!SHARE_RE.test(share)) throw httpErr(400, "That share name isn't valid.");
    const id = await store.get("s:" + share);
    const b = id && (await store.get("b:" + id, { type: "json" }));
    if (!b) throw httpErr(404, "No board with that share name.");
    return publicView(b);
  }
  if (method !== "POST") throw httpErr(405, "Method not allowed.");
  const action = body.action;
  const now = Date.now();
  if (action === "create") {
    const state = cleanState(body.state);
    const share = await freeShare(store, String(body.share || "").toLowerCase(), state.name);
    const edit = newEditCode(); const id = newId();
    const b = { id, name: state.name, share, state, editHash: hash(edit), created: now, updated: now };
    await store.setJSON("b:" + id, b); await store.set("s:" + share, id); await store.set("e:" + b.editHash, id);
    return { id, edit, share, updated: now };
  }
  if (action === "check") {
    const share = String(body.share || "").toLowerCase();
    if (!SHARE_RE.test(share) || RESERVED.has(share)) return { ok: false, reason: "invalid" };
    return { ok: !(await store.get("s:" + share)) };
  }
  const b = await boardByEdit(store, body.edit);
  if (action === "load") return { id: b.id, share: b.share, name: b.name, state: b.state, updated: b.updated };
  if (action === "save") {
    b.state = cleanState(body.state); b.name = b.state.name; b.updated = now;
    await store.setJSON("b:" + b.id, b); return { ok: true, updated: now, share: b.share };
  }
  if (action === "rename") {
    const share = String(body.share || "").toLowerCase();
    if (share === b.share) return { ok: true, share };
    if (!SHARE_RE.test(share)) throw httpErr(400, "Use 3–20 letters, numbers or dashes.");
    if (RESERVED.has(share)) throw httpErr(409, "That name is reserved. Try another.");
    if (await store.get("s:" + share)) throw httpErr(409, "That share name is taken. Try another.");
    await store.set("s:" + share, b.id); await store.delete("s:" + b.share);
    b.share = share; b.updated = now; await store.setJSON("b:" + b.id, b);
    return { ok: true, share };
  }
  if (action === "delete") {
    await store.delete("s:" + b.share); await store.delete("e:" + b.editHash); await store.delete("b:" + b.id);
    return { ok: true };
  }
  throw httpErr(400, "Unknown action.");
}
