export type Point = { id: string; x: number; y: number };
export type Edge = { id: string; a: string; b: string };
export type Face = { id: string; points: string[] };

export type Doc = {
  points: Record<string, Point>;
  edges: Record<string, Edge>;
  faces: Record<string, Face>;
};

export type Item = { kind: "point" | "edge" | "face"; id: string };

export type Guide = { axis: "x" | "y"; value: number };
export type Snap = { x: number; y: number; pointId?: string; guides: Guide[] };

/** Nice step values in cm, used by the grid, the scale bar, and grid snapping. */
export const NICE_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
];

export const emptyDoc = (): Doc => ({ points: {}, edges: {}, faces: {} });

export const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(bx - ax, by - ay);

/** Smallest nice step whose on-screen size is at least `minPx`. */
export function gridStep(k: number, minPx = 12): number {
  for (const s of NICE_STEPS) if (s * k >= minPx) return s;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

/** Largest nice step that fits within `maxPx` on screen. */
export function scaleStep(k: number, maxPx = 160): number {
  let best = NICE_STEPS[0];
  for (const s of NICE_STEPS) if (s * k <= maxPx) best = s;
  return best;
}

/**
 * Snap a world position: first to a nearby point, then to the x / y of any
 * point (alignment guides), and finally to the grid.
 */
export function snapPoint(
  doc: Doc,
  x: number,
  y: number,
  tol: number,
  grid: number,
  exclude: ReadonlySet<string>
): Snap {
  let nearest: Point | undefined;
  let nearestD = tol;
  let gx: Point | undefined;
  let gy: Point | undefined;
  let dx = tol;
  let dy = tol;

  for (const p of Object.values(doc.points)) {
    if (exclude.has(p.id)) continue;
    const d = dist(p.x, p.y, x, y);
    if (d < nearestD) {
      nearestD = d;
      nearest = p;
    }
    const ax = Math.abs(p.x - x);
    if (ax < dx) {
      dx = ax;
      gx = p;
    }
    const ay = Math.abs(p.y - y);
    if (ay < dy) {
      dy = ay;
      gy = p;
    }
  }

  if (nearest) {
    return { x: nearest.x, y: nearest.y, pointId: nearest.id, guides: [] };
  }

  const guides: Guide[] = [];
  let sx = Math.round(x / grid) * grid;
  let sy = Math.round(y / grid) * grid;
  if (gx) {
    sx = gx.x;
    guides.push({ axis: "x", value: gx.x });
  }
  if (gy) {
    sy = gy.y;
    guides.push({ axis: "y", value: gy.y });
  }
  return { x: sx, y: sy, guides };
}

export function edgeBetween(doc: Doc, a: string, b: string): Edge | undefined {
  return Object.values(doc.edges).find(
    (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)
  );
}

export function pointAt(doc: Doc, x: number, y: number): Point | undefined {
  return Object.values(doc.points).find(
    (p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6
  );
}

/** Reuse an existing point at (x, y) or create one. Mutates `doc`. */
export function ensurePoint(doc: Doc, x: number, y: number): string {
  const existing = pointAt(doc, x, y);
  if (existing) return existing.id;
  const id = uid("p");
  doc.points[id] = { id, x, y };
  return id;
}

/** Reuse an existing edge between a and b or create one. Mutates `doc`. */
export function ensureEdge(doc: Doc, a: string, b: string): string {
  const existing = edgeBetween(doc, a, b);
  if (existing) return existing.id;
  const id = uid("e");
  doc.edges[id] = { id, a, b };
  return id;
}

export const faceKey = (points: string[]) => [...points].sort().join("|");

/** Shortest path a → b that does not use `edgeId`, as an ordered point list. */
export function findCycle(doc: Doc, edgeId: string): string[] | null {
  const edge = doc.edges[edgeId];
  if (!edge) return null;
  const adj = new Map<string, string[]>();
  for (const e of Object.values(doc.edges)) {
    if (e.id === edgeId) continue;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const prev = new Map<string, string | null>([[edge.a, null]]);
  const queue = [edge.a];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === edge.b) {
      const path: string[] = [];
      for (let n: string | null = cur; n; n = prev.get(n) ?? null) path.push(n);
      return path.reverse();
    }
    for (const next of adj.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }
  return null;
}

/**
 * After adding edge a-b: split an existing face that contains both endpoints
 * as non-adjacent vertices, otherwise close a new face if a cycle exists.
 * Mutates `doc`.
 */
export function closeFaces(doc: Doc, edgeId: string) {
  const edge = doc.edges[edgeId];
  if (!edge) return;

  for (const face of Object.values(doc.faces)) {
    const i = face.points.indexOf(edge.a);
    const j = face.points.indexOf(edge.b);
    if (i < 0 || j < 0) continue;
    const n = face.points.length;
    const adjacent = (i + 1) % n === j || (j + 1) % n === i;
    if (adjacent) return;
    const [lo, hi] = i < j ? [i, j] : [j, i];
    const first = face.points.slice(lo, hi + 1);
    const second = [...face.points.slice(hi), ...face.points.slice(0, lo + 1)];
    delete doc.faces[face.id];
    for (const pts of [first, second]) {
      const id = uid("f");
      doc.faces[id] = { id, points: pts };
    }
    return;
  }

  const cycle = findCycle(doc, edgeId);
  if (!cycle || cycle.length < 3) return;
  const key = faceKey(cycle);
  if (Object.values(doc.faces).some((f) => faceKey(f.points) === key)) return;
  const id = uid("f");
  doc.faces[id] = { id, points: cycle };
}

export function pointIdsOf(doc: Doc, item: Item): string[] {
  if (item.kind === "point") return [item.id];
  if (item.kind === "edge") {
    const e = doc.edges[item.id];
    return e ? [e.a, e.b] : [];
  }
  return doc.faces[item.id]?.points ?? [];
}

/** Remove an item and everything that can no longer exist without it. */
export function removeItem(doc: Doc, item: Item): Doc {
  const next: Doc = {
    points: { ...doc.points },
    edges: { ...doc.edges },
    faces: { ...doc.faces },
  };

  if (item.kind === "face") {
    const face = next.faces[item.id];
    if (!face) return doc;
    delete next.faces[item.id];
    const n = face.points.length;
    for (let i = 0; i < n; i++) {
      const e = edgeBetween(next, face.points[i], face.points[(i + 1) % n]);
      if (e && !faceUsesEdge(next, e)) delete next.edges[e.id];
    }
  } else if (item.kind === "edge") {
    delete next.edges[item.id];
  } else {
    delete next.points[item.id];
    for (const e of Object.values(next.edges)) {
      if (e.a === item.id || e.b === item.id) delete next.edges[e.id];
    }
  }

  // Faces whose boundary lost an edge are gone; points nothing uses are gone.
  for (const f of Object.values(next.faces)) {
    const n = f.points.length;
    const intact = f.points.every((p, i) =>
      edgeBetween(next, p, f.points[(i + 1) % n])
    );
    if (!intact) delete next.faces[f.id];
  }
  const used = new Set<string>();
  for (const e of Object.values(next.edges)) used.add(e.a).add(e.b);
  for (const p of Object.keys(next.points))
    if (!used.has(p)) delete next.points[p];
  return next;
}

function faceUsesEdge(doc: Doc, e: Edge): boolean {
  return Object.values(doc.faces).some((f) => {
    const n = f.points.length;
    return f.points.some((p, i) => {
      const q = f.points[(i + 1) % n];
      return (p === e.a && q === e.b) || (p === e.b && q === e.a);
    });
  });
}
