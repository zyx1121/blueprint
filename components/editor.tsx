"use client";

import { useEffect, useRef, useState } from "react";

import { Inspector } from "@/components/inspector";
import { ScaleBar } from "@/components/scale-bar";
import { Toolbar, type Tool } from "@/components/toolbar";
import {
  axisRect,
  closeFaces,
  dist,
  emptyDoc,
  ensureEdge,
  ensurePoint,
  gridStep,
  placePoint,
  pointIdsOf,
  removeItem,
  round1,
  snapPoint,
  type Doc,
  type Guide,
  type Item,
} from "@/lib/geometry";
import { cn } from "@/lib/utils";

/** Screen pixels per centimetre at zoom 1. */
const PX_PER_CM = 4;
const SNAP_PX = 8;
const MIN_K = 0.05;
const MAX_K = 400;

/** screen = world * k + (x, y) */
type View = { x: number; y: number; k: number };
type XY = { x: number; y: number };
type SnapXY = XY & { pointId?: string; edgeId?: string };

type Drag =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { type: "rect"; a: SnapXY; b: SnapXY }
  | {
      type: "line";
      a: SnapXY;
      b: SnapXY;
      startId: string | null;
      endId: string | null;
    }
  | {
      type: "move";
      ids: string[];
      origin: Record<string, XY>;
      start: XY;
      moved: boolean;
    };

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function Editor() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<View>({ x: 0, y: 0, k: PX_PER_CM });
  const [doc, setDoc] = useState<Doc>(emptyDoc);
  const [sel, setSel] = useState<Item | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [space, setSpace] = useState(false);
  const [history, setHistory] = useState<{ past: Doc[]; future: Doc[] }>({
    past: [],
    future: [],
  });

  const txStart = useRef<Doc | null>(null);

  const apply = (next: Doc) => {
    setHistory((h) => ({ past: [...h.past, doc], future: [] }));
    setDoc(next);
  };
  const undo = () => {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      future: [...h.future, doc],
    }));
    setDoc(prev);
    setSel(null);
  };
  const redo = () => {
    const next = history.future.at(-1);
    if (!next) return;
    setHistory((h) => ({
      past: [...h.past, doc],
      future: h.future.slice(0, -1),
    }));
    setDoc(next);
    setSel(null);
  };
  const remove = () => {
    if (!sel) return;
    apply(removeItem(doc, sel));
    setSel(null);
  };

  const movePoints = (updates: Record<string, XY>) => {
    const points = { ...doc.points };
    for (const [id, xy] of Object.entries(updates)) {
      if (points[id])
        points[id] = { ...points[id], x: round1(xy.x), y: round1(xy.y) };
    }
    apply({ ...doc, points });
  };
  const setPoint = (id: string, x: number, y: number) =>
    movePoints({ [id]: { x, y } });
  /** Keep `a` fixed and slide `b` along the edge direction. */
  const setEdgeLength = (id: string, length: number) => {
    const e = doc.edges[id];
    const a = e && doc.points[e.a];
    const b = e && doc.points[e.b];
    if (!a || !b) return;
    const d = dist(a.x, a.y, b.x, b.y);
    if (d === 0) return;
    const ux = (b.x - a.x) / d;
    const uy = (b.y - a.y) / d;
    movePoints({ [b.id]: { x: a.x + ux * length, y: a.y + uy * length } });
  };
  /** Resize an axis-aligned rectangle, anchored at its top-left corner. */
  const setRectSize = (id: string, width: number, height: number) => {
    const f = doc.faces[id];
    const r = f && axisRect(doc, f);
    if (!f || !r) return;
    const updates: Record<string, XY> = {};
    for (const pid of f.points) {
      const p = doc.points[pid];
      updates[pid] = {
        x: p.x === r.maxX ? r.minX + width : p.x,
        y: p.y === r.maxY ? r.minY + height : p.y,
      };
    }
    movePoints(updates);
  };

  const toWorld = (e: { clientX: number; clientY: number }): XY => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.x) / view.k,
      y: (e.clientY - r.top - view.y) / view.k,
    };
  };
  const snap = (
    p: XY,
    exclude: Iterable<string> = [],
    axisExclude: Iterable<string> = exclude
  ) =>
    snapPoint(
      doc,
      p.x,
      p.y,
      SNAP_PX / view.k,
      gridStep(view.k),
      new Set(exclude),
      new Set(axisExclude)
    );

  // Centre the origin once the canvas has a size.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2, y: r.height / 2 }));
  }, []);

  // Wheel: pan by default, zoom with ctrl / cmd (trackpad pinch sets ctrlKey).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (!e.ctrlKey && !e.metaKey) {
          return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
        }
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.01), MIN_K, MAX_K);
        return {
          k,
          x: px - (px - v.x) * (k / v.k),
          y: py - (py - v.y) * (k / v.k),
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          setSpace(true);
          break;
        case "v":
        case "V":
          setTool("select");
          break;
        case "r":
        case "R":
          setTool("rect");
          break;
        case "l":
        case "L":
          setTool("line");
          break;
        case "h":
        case "H":
          setTool("hand");
          break;
        case "Escape":
          setDrag(null);
          setGuides([]);
          setSel(null);
          break;
        case "Delete":
        case "Backspace":
          remove();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpace(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  const onCanvasDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || space || tool === "hand") {
      setDrag({
        type: "pan",
        sx: e.clientX,
        sy: e.clientY,
        vx: view.x,
        vy: view.y,
      });
      return;
    }
    if (e.button !== 0) return;
    const p = toWorld(e);
    if (tool === "rect") {
      const s = snap(p);
      setDrag({ type: "rect", a: s, b: s });
    } else if (tool === "line") {
      const s = snap(p);
      setDrag({
        type: "line",
        a: s,
        b: s,
        startId: s.pointId ?? null,
        endId: null,
      });
    } else {
      setSel(null);
    }
  };

  const onItemDown = (e: React.PointerEvent, item: Item) => {
    if (tool !== "select" || space || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    setSel(item);
    const ids = pointIdsOf(doc, item);
    const origin = Object.fromEntries(
      ids.map((id) => [id, { x: doc.points[id].x, y: doc.points[id].y }])
    );
    txStart.current = doc;
    setDrag({ type: "move", ids, origin, start: toWorld(e), moved: false });
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.type === "pan") {
      setView((v) => ({
        ...v,
        x: drag.vx + (e.clientX - drag.sx),
        y: drag.vy + (e.clientY - drag.sy),
      }));
      return;
    }
    const p = toWorld(e);
    if (drag.type === "rect") {
      const s = snap(p);
      setGuides(s.guides);
      setDrag({ ...drag, b: s });
    } else if (drag.type === "line") {
      // The start point must not capture the end, but aligning to it is wanted.
      const s = snap(p, drag.startId ? [drag.startId] : [], []);
      setGuides(s.guides);
      setDrag({ ...drag, b: s, endId: s.pointId ?? null });
    } else {
      const anchor = drag.origin[drag.ids[0]];
      const raw = {
        x: anchor.x + (p.x - drag.start.x),
        y: anchor.y + (p.y - drag.start.y),
      };
      const s = snap(raw, drag.ids);
      const dx = s.x - anchor.x;
      const dy = s.y - anchor.y;
      setGuides(s.guides);
      setDoc((d) => {
        const points = { ...d.points };
        for (const id of drag.ids) {
          const o = drag.origin[id];
          points[id] = { ...points[id], x: o.x + dx, y: o.y + dy };
        }
        return { ...d, points };
      });
      if (!drag.moved) setDrag({ ...drag, moved: true });
    }
  };

  const onUp = () => {
    if (!drag) return;
    setGuides([]);
    setDrag(null);
    if (drag.type === "rect") {
      const { a, b } = drag;
      if (a.x === b.x || a.y === b.y) return;
      const next = structuredClone(doc);
      const ids = [
        placePoint(next, a),
        ensurePoint(next, b.x, a.y),
        placePoint(next, b),
        ensurePoint(next, a.x, b.y),
      ];
      ids.forEach((id, i) => ensureEdge(next, id, ids[(i + 1) % 4]));
      const key = [...ids].sort().join("|");
      const exists = Object.values(next.faces).some(
        (f) => [...f.points].sort().join("|") === key
      );
      if (!exists) {
        const id = `f_${Math.random().toString(36).slice(2, 9)}`;
        next.faces[id] = { id, points: ids };
      }
      apply(next);
    } else if (drag.type === "line") {
      const { a, b, startId, endId } = drag;
      if (startId && startId === endId) return;
      if (dist(a.x, a.y, b.x, b.y) < 1e-6) return;
      const next = structuredClone(doc);
      const s = startId ?? placePoint(next, a);
      const t = endId ?? placePoint(next, b);
      if (s === t) return;
      closeFaces(next, ensureEdge(next, s, t));
      apply(next);
    } else if (drag.type === "move") {
      const start = txStart.current;
      txStart.current = null;
      if (drag.moved && start && start !== doc) {
        setHistory((h) => ({ past: [...h.past, start], future: [] }));
      }
    }
  };

  const { k } = view;
  const step = gridStep(k);
  const selectedPoints = sel
    ? pointIdsOf(doc, sel)
        .map((id) => doc.points[id])
        .filter(Boolean)
    : [];
  const snapTarget =
    drag?.type === "rect" || drag?.type === "line"
      ? drag.b.pointId
        ? drag.b
        : null
      : null;
  const major = step * 5;
  const showLabels = k >= 1.5;
  const cursor =
    drag?.type === "pan"
      ? "cursor-grabbing"
      : space || tool === "hand"
        ? "cursor-grab"
        : tool === "select"
          ? "cursor-default"
          : "cursor-crosshair";

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <svg
        ref={svgRef}
        className={cn("h-full w-full touch-none select-none", cursor)}
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id="grid-minor"
            width={step * k}
            height={step * k}
            x={view.x}
            y={view.y}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${step * k} 0 L 0 0 0 ${step * k}`}
              fill="none"
              className="stroke-foreground/8"
              strokeWidth={1}
            />
          </pattern>
          <pattern
            id="grid-major"
            width={major * k}
            height={major * k}
            x={view.x}
            y={view.y}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${major * k} 0 L 0 0 0 ${major * k}`}
              fill="none"
              className="stroke-foreground/15"
              strokeWidth={1}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-minor)" />
        <rect width="100%" height="100%" fill="url(#grid-major)" />

        <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
          {Object.values(doc.faces).map((f) => {
            const pts = f.points
              .map((id) => doc.points[id])
              .filter(Boolean)
              .map((p) => `${p.x},${p.y}`)
              .join(" ");
            const active = sel?.kind === "face" && sel.id === f.id;
            return (
              <polygon
                key={f.id}
                points={pts}
                className={cn(
                  "stroke-none transition-colors",
                  active
                    ? "fill-primary/25"
                    : "fill-primary/10 hover:fill-primary/15"
                )}
                onPointerDown={(e) => onItemDown(e, { kind: "face", id: f.id })}
              />
            );
          })}

          {Object.values(doc.edges).map((e) => {
            const a = doc.points[e.a];
            const b = doc.points[e.b];
            if (!a || !b) return null;
            const active = sel?.kind === "edge" && sel.id === e.id;
            const len = dist(a.x, a.y, b.x, b.y);
            let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            if (deg > 90 || deg <= -90) deg += 180;
            return (
              <g key={e.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={active ? "stroke-primary" : "stroke-foreground"}
                  strokeWidth={active ? 2.5 : 1.5}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={12 / k}
                  className="cursor-move"
                  onPointerDown={(ev) =>
                    onItemDown(ev, { kind: "edge", id: e.id })
                  }
                />
                {showLabels && len * k > 40 && (
                  <text
                    transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${deg})`}
                    dy={-5 / k}
                    textAnchor="middle"
                    fontSize={11 / k}
                    className="pointer-events-none fill-muted-foreground tabular-nums"
                  >
                    {formatCm(len)}
                  </text>
                )}
              </g>
            );
          })}

          {selectedPoints.map((p) => {
            const active = sel?.kind === "point" && sel.id === p.id;
            return (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r={(active ? 5 : 3.5) / k}
                className={cn(
                  "cursor-move fill-background stroke-2",
                  active ? "stroke-primary" : "stroke-foreground"
                )}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(e) =>
                  onItemDown(e, { kind: "point", id: p.id })
                }
              />
            );
          })}

          {drag?.type === "rect" && (
            <rect
              x={Math.min(drag.a.x, drag.b.x)}
              y={Math.min(drag.a.y, drag.b.y)}
              width={Math.abs(drag.b.x - drag.a.x)}
              height={Math.abs(drag.b.y - drag.a.y)}
              className="fill-primary/10 stroke-primary"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {snapTarget && (
            <circle
              cx={snapTarget.x}
              cy={snapTarget.y}
              r={5 / k}
              className="fill-none stroke-primary"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {drag?.type === "line" && (
            <line
              x1={drag.a.x}
              y1={drag.a.y}
              x2={drag.b.x}
              y2={drag.b.y}
              className="stroke-primary"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </g>

        {guides.map((g) => (
          <line
            key={`${g.axis}${g.value}`}
            x1={g.axis === "x" ? g.value * k + view.x : 0}
            x2={g.axis === "x" ? g.value * k + view.x : "100%"}
            y1={g.axis === "y" ? g.value * k + view.y : 0}
            y2={g.axis === "y" ? g.value * k + view.y : "100%"}
            className="stroke-destructive/70"
            strokeWidth={1}
            strokeDasharray="4 4"
            pointerEvents="none"
          />
        ))}
      </svg>

      {sel && (
        <Inspector
          doc={doc}
          sel={sel}
          onPoint={setPoint}
          onEdgeLength={setEdgeLength}
          onRectSize={setRectSize}
        />
      )}
      <ScaleBar k={k} />
      <Toolbar
        tool={tool}
        onTool={setTool}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        canDelete={sel !== null}
        onUndo={undo}
        onRedo={redo}
        onDelete={remove}
      />
    </div>
  );
}

function formatCm(cm: number) {
  const v = Math.round(cm * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} cm`;
}
