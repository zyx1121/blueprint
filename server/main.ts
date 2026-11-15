// Serves the static export and the one shared drawing.
//   GET  /api/doc     -> { rev, doc }
//   POST /api/ops     <- { from, ops }  -> { rev }
//   GET  /api/events  -> server-sent events, one { rev, from, ops } per change
// Build: bun build --compile server/main.ts --outfile blueprint
import { mkdirSync, renameSync, writeFileSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

import { emptyDoc, type Doc } from "../lib/geometry";
import { applyOps, isOp, type Op } from "../lib/ops";

const PORT = Number(process.env.PORT ?? 3000);
const WEB_DIR = process.env.WEB_DIR ?? "web";
const DATA_DIR = process.env.DATA_DIR ?? "data";
const MAX_BODY = 1 << 20;
const MAX_DOC = 4 << 20;
const MAX_OPS = 5000;

mkdirSync(join(DATA_DIR, "backups"), { recursive: true });
const docFile = join(DATA_DIR, "doc.json");

let rev = 0;
let doc: Doc = emptyDoc();
try {
  const saved = JSON.parse(readFileSync(docFile, "utf8"));
  rev = saved.rev ?? 0;
  doc = saved.doc ?? emptyDoc();
} catch {
  // No drawing yet.
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const body = JSON.stringify({ rev, doc });
    writeFileSync(docFile + ".tmp", body);
    renameSync(docFile + ".tmp", docFile);
    // One copy per day, so a bad edit can be rolled back by hand.
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(join(DATA_DIR, "backups", `${day}.json`), body);
  }, 500);
}

const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
function broadcast(msg: string) {
  const chunk = enc.encode(msg);
  for (const c of clients) {
    try {
      c.enqueue(chunk);
    } catch {
      clients.delete(c);
    }
  }
}
setInterval(() => broadcast(": ping\n\n"), 20_000);

function events(req: Request) {
  let self: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      self = c;
      clients.add(c);
      c.enqueue(enc.encode(`retry: 2000\n\n`));
    },
    cancel() {
      clients.delete(self);
    },
  });
  req.signal.addEventListener("abort", () => clients.delete(self));
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

async function postOps(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return new Response("too large", { status: 413 });
  let body: { from?: unknown; ops?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const ops = body.ops;
  if (!Array.isArray(ops) || ops.length > MAX_OPS || !ops.every(isOp)) {
    return new Response("bad ops", { status: 400 });
  }
  const next = applyOps(doc, ops as Op[]);
  if (JSON.stringify(next).length > MAX_DOC) {
    return new Response("drawing too large", { status: 413 });
  }
  doc = next;
  rev += 1;
  save();
  const from = typeof body.from === "string" ? body.from.slice(0, 64) : "";
  broadcast(`data: ${JSON.stringify({ rev, from, ops })}\n\n`);
  return Response.json({ rev });
}

async function staticFile(path: string) {
  const clean = normalize(decodeURIComponent(path)).replace(
    /^(\.\.[/\\])+/,
    ""
  );
  const candidates = clean.endsWith("/")
    ? [join(WEB_DIR, clean, "index.html")]
    : [join(WEB_DIR, clean), join(WEB_DIR, clean + ".html")];
  for (const p of candidates) {
    const f = Bun.file(p);
    if (await f.exists()) return new Response(f);
  }
  return new Response(Bun.file(join(WEB_DIR, "404.html")), { status: 404 });
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/doc" && req.method === "GET") {
      return Response.json(
        { rev, doc },
        { headers: { "cache-control": "no-store" } }
      );
    }
    if (pathname === "/api/ops" && req.method === "POST") return postOps(req);
    if (pathname === "/api/events" && req.method === "GET") return events(req);
    if (pathname.startsWith("/api/"))
      return new Response("not found", { status: 404 });
    return staticFile(pathname);
  },
});

console.log(`blueprint on :${PORT}, rev ${rev}`);
