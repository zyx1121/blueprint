import type { Doc } from "@/lib/geometry";

/** One entity written (v) or removed (v = null). */
export type Op = {
  t: keyof Doc;
  id: string;
  v: Doc[keyof Doc][string] | null;
};

const KINDS: (keyof Doc)[] = ["points", "edges", "faces"];

/** Ops that turn `from` into `to`, compared entity by entity. */
export function diff(from: Doc, to: Doc): Op[] {
  const ops: Op[] = [];
  for (const t of KINDS) {
    const a = from[t] as Record<string, unknown>;
    const b = to[t] as Record<string, unknown>;
    for (const id in b) {
      if (a[id] !== b[id] && JSON.stringify(a[id]) !== JSON.stringify(b[id])) {
        ops.push({ t, id, v: b[id] as Op["v"] });
      }
    }
    for (const id in a) if (!(id in b)) ops.push({ t, id, v: null });
  }
  return ops;
}

/** A new doc with the ops applied; untouched maps keep their identity. */
export function applyOps(doc: Doc, ops: Op[]): Doc {
  if (ops.length === 0) return doc;
  const next = { ...doc };
  for (const t of KINDS) {
    const mine = ops.filter((o) => o.t === t);
    if (mine.length === 0) continue;
    const map = { ...(doc[t] as Record<string, unknown>) };
    for (const o of mine) {
      if (o.v === null) delete map[o.id];
      else map[o.id] = o.v;
    }
    (next as Record<string, unknown>)[t] = map;
  }
  return next;
}

export function isOp(o: unknown): o is Op {
  if (!o || typeof o !== "object") return false;
  const { t, id, v } = o as Record<string, unknown>;
  return (
    KINDS.includes(t as keyof Doc) &&
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 64 &&
    (v === null || (typeof v === "object" && !Array.isArray(v)))
  );
}
