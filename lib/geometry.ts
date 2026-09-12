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
export type Snap = {
  x: number;
  y: number;
  pointId?: string;
  edgeId?: string;
  guides: Guide[];
};

/** Nice step values in cm, used by the grid, the scale bar, and grid snapping. */
export const NICE_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
];

export const emptyDoc = (): Doc => ({ points: {}, edges: {}, faces: {} });

export const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(bx - ax, by - ay);

/** Smallest unit of the model: 0.1 cm. */
export const round1 = (v: number) => Math.round(v * 10) / 10;

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
 * point (alignment guides), then to a grid line when close to one, and
 * otherwise round to 0.1 cm.
 */
export function snapPoint(
  doc: Doc,
  x: number,
  y: number,
  tol: number,
  grid: number,
  exclude: ReadonlySet<string>,
  axisExclude: ReadonlySet<string> = exclude
): Snap {
  let nearest: Point | undefined;
  let nearestD = tol;
  let gx: Point | undefined;
  let gy: Point | undefined;
  let dx = tol;
  let dy = tol;

  for (const p of Object.values(doc.points)) {
    if (!exclude.has(p.id)) {
      const d = dist(p.x, p.y, x, y);
      if (d < nearestD) {
        nearestD = d;
        nearest = p;
      }
    }
    if (axisExclude.has(p.id)) continue;
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

  const onEdge = nearestEdge(doc, x, y, tol, exclude);
  if (onEdge) {
    return {
      x: round1(onEdge.x),
      y: round1(onEdge.y),
      edgeId: onEdge.id,
      guides: [],
    };
  }

  const guides: Guide[] = [];
  const gridX = Math.round(x / grid) * grid;
  const gridY = Math.round(y / grid) * grid;
  let sx = Math.abs(gridX - x) < tol ? gridX : round1(x);
  let sy = Math.abs(gridY - y) < tol ? gridY : round1(y);
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

/** Closest edge whose projection of (x, y) lies within the segment and `tol`. */
function nearestEdge(
  doc: Doc,
  x: number,
  y: number,
  tol: number,
  exclude: ReadonlySet<string>
): { id: string; x: number; y: number } | null {
  let best: { id: string; x: number; y: number } | null = null;
  let bestD = tol;
  for (const e of Object.values(doc.edges)) {
    if (exclude.has(e.a) || exclude.has(e.b)) continue;
    const a = doc.points[e.a];
    const b = doc.points[e.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    if (t <= 0 || t >= 1) continue;
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = dist(px, py, x, y);
    if (d < bestD) {
      bestD = d;
      best = { id: e.id, x: px, y: py };
    }
  }
  return best;
}

/**
 * Place a point from a snap result: reuse an existing point, or create one
 * and, when it landed on an edge, split that edge so faces stay closed.
 * Mutates `doc`.
 */
export function placePoint(
  doc: Doc,
  at: { x: number; y: number; pointId?: string; edgeId?: string }
): string {
  if (at.pointId && doc.points[at.pointId]) return at.pointId;
  const existing = pointAt(doc, at.x, at.y);
  if (existing) return existing.id;
  const id = ensurePoint(doc, at.x, at.y);
  // The snapped edge may already have been split by an earlier placement.
  const edgeId = doc.edges[at.edgeId ?? ""]
    ? at.edgeId
    : nearestEdge(doc, at.x, at.y, 0.05, new Set([id]))?.id;
  if (edgeId) splitEdge(doc, edgeId, id);
  return id;
}

/** Replace edge a-b with a-p and p-b, inserting p into every face using a-b. */
export function splitEdge(doc: Doc, edgeId: string, pointId: string) {
  const e = doc.edges[edgeId];
  if (!e) return;
  delete doc.edges[edgeId];
  ensureEdge(doc, e.a, pointId);
  ensureEdge(doc, pointId, e.b);
  for (const f of Object.values(doc.faces)) {
    const n = f.points.length;
    for (let i = 0; i < n; i++) {
      const p = f.points[i];
      const q = f.points[(i + 1) % n];
      if ((p === e.a && q === e.b) || (p === e.b && q === e.a)) {
        f.points = [
          ...f.points.slice(0, i + 1),
          pointId,
          ...f.points.slice(i + 1),
        ];
        break;
      }
    }
  }
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
    const edge = next.edges[item.id];
    if (!edge) return doc;
    delete next.edges[item.id];
    const sharing = Object.values(next.faces).filter((f) =>
      faceHasEdge(f, edge.a, edge.b)
    );
    if (sharing.length === 2) {
      const [f1, f2] = sharing;
      const first = openAt(f1, edge.a, edge.b);
      const second = openAt(f2, edge.b, edge.a);
      delete next.faces[f1.id];
      delete next.faces[f2.id];
      const id = uid("f");
      next.faces[id] = { id, points: [...first, ...second.slice(1, -1)] };
    }
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

function faceHasEdge(f: Face, a: string, b: string): boolean {
  const n = f.points.length;
  return f.points.some((p, i) => {
    const q = f.points[(i + 1) % n];
    return (p === a && q === b) || (p === b && q === a);
  });
}

function faceUsesEdge(doc: Doc, e: Edge): boolean {
  return Object.values(doc.faces).some((f) => faceHasEdge(f, e.a, e.b));
}

/** Walk the face boundary from b around to a without crossing edge a-b. */
function openAt(f: Face, a: string, b: string): string[] {
  const n = f.points.length;
  const i = f.points.indexOf(a);
  const j = f.points.indexOf(b);
  const seq: string[] = [];
  if ((i + 1) % n === j) {
    for (let s = 0; s < n; s++) seq.push(f.points[(j + s) % n]);
  } else {
    for (let s = 0; s < n; s++) seq.push(f.points[(i + s) % n]);
    seq.reverse();
  }
  return seq;
}

/** Shoelace area in cm². */
export function faceArea(doc: Doc, f: Face): number {
  const pts = f.points.map((id) => doc.points[id]).filter(Boolean);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

export function facePerimeter(doc: Doc, f: Face): number {
  const pts = f.points.map((id) => doc.points[id]).filter(Boolean);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += dist(p.x, p.y, q.x, q.y);
  }
  return sum;
}

/** Bounding box of a face when it is an axis-aligned rectangle. */
export function axisRect(
  doc: Doc,
  f: Face
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (f.points.length !== 4) return null;
  const pts = f.points.map((id) => doc.points[id]);
  if (pts.some((p) => !p)) return null;
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % 4];
    if (p.x !== q.x && p.y !== q.y) return null;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
