"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  axisRect,
  dist,
  faceArea,
  facePerimeter,
  round1,
  type Doc,
  type Item,
} from "@/lib/geometry";

type Props = {
  doc: Doc;
  sel: Item;
  onPoint: (id: string, x: number, y: number) => void;
  onEdgeLength: (id: string, length: number) => void;
  onRectSize: (id: string, width: number, height: number) => void;
};

export function Inspector({
  doc,
  sel,
  onPoint,
  onEdgeLength,
  onRectSize,
}: Props) {
  const body = (() => {
    if (sel.kind === "point") {
      const p = doc.points[sel.id];
      if (!p) return null;
      return (
        <>
          <Field
            label="X"
            value={p.x}
            onCommit={(v) => onPoint(p.id, v, p.y)}
          />
          <Field
            label="Y"
            value={p.y}
            onCommit={(v) => onPoint(p.id, p.x, v)}
          />
        </>
      );
    }
    if (sel.kind === "edge") {
      const e = doc.edges[sel.id];
      const a = e && doc.points[e.a];
      const b = e && doc.points[e.b];
      if (!a || !b) return null;
      return (
        <>
          <Field
            label="長度"
            value={dist(a.x, a.y, b.x, b.y)}
            min={0.1}
            onCommit={(v) => onEdgeLength(e.id, v)}
          />
          <Row label="起點" value={`${fmt(a.x)}, ${fmt(a.y)}`} />
          <Row label="終點" value={`${fmt(b.x)}, ${fmt(b.y)}`} />
        </>
      );
    }
    const f = doc.faces[sel.id];
    if (!f) return null;
    const rect = axisRect(doc, f);
    return (
      <>
        {rect && (
          <>
            <Field
              label="寬"
              value={rect.maxX - rect.minX}
              min={0.1}
              onCommit={(v) => onRectSize(f.id, v, rect.maxY - rect.minY)}
            />
            <Field
              label="高"
              value={rect.maxY - rect.minY}
              min={0.1}
              onCommit={(v) => onRectSize(f.id, rect.maxX - rect.minX, v)}
            />
          </>
        )}
        <Row label="頂點" value={`${f.points.length}`} />
        <Row label="周長" value={`${fmt(facePerimeter(doc, f))} cm`} />
        <Row label="面積" value={`${fmt(faceArea(doc, f))} cm²`} />
      </>
    );
  })();

  const title =
    sel.kind === "point" ? "頂點" : sel.kind === "edge" ? "線段" : "面";

  return (
    <aside className="fixed top-6 right-6 z-10 flex w-56 flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 shadow-lg backdrop-blur-md">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {body}
    </aside>
  );
}

const fmt = (v: number) => {
  const r = round1(v);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit: (v: number) => void;
}) {
  // Keyed on the committed value so the draft resets when the model changes.
  return (
    <Draft
      key={fmt(value)}
      label={label}
      initial={fmt(value)}
      min={min}
      onCommit={onCommit}
    />
  );
}

function Draft({
  label,
  initial,
  min,
  onCommit,
}: {
  label: string;
  initial: string;
  min?: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(initial);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v) || (min !== undefined && v < min)) {
      setText(initial);
      return;
    }
    const r = round1(v);
    if (fmt(r) !== initial) onCommit(r);
    else setText(initial);
  };
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <Input
          type="number"
          step={0.1}
          min={min}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(initial);
          }}
          className="h-7 w-20 px-2 text-right tabular-nums"
        />
        <span className="text-muted-foreground">cm</span>
      </span>
    </label>
  );
}
