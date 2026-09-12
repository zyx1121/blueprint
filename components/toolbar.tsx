"use client";

import {
  Copy,
  Hand,
  MousePointer2,
  Redo2,
  Slash,
  Square,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type Tool = "select" | "rect" | "line" | "marker" | "hand";

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "選取", key: "V" },
  { id: "rect", icon: Square, label: "矩形", key: "R" },
  { id: "line", icon: Slash, label: "線段", key: "L" },
  { id: "marker", icon: X, label: "標記", key: "M" },
  { id: "hand", icon: Hand, label: "平移", key: "H" },
];

type Props = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  canCopy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
};

export function Toolbar({
  tool,
  onTool,
  canUndo,
  canRedo,
  canDelete,
  canCopy,
  onUndo,
  onRedo,
  onDelete,
  onDuplicate,
}: Props) {
  return (
    <div className="fixed bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-border/60 bg-background/70 p-1.5 shadow-lg backdrop-blur-md">
      {TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          icon={t.icon}
          label={`${t.label} (${t.key})`}
          active={tool === t.id}
          onClick={() => onTool(t.id)}
        />
      ))}
      <Separator orientation="vertical" className="mx-1" />
      <ToolButton
        icon={Undo2}
        label="復原 (⌘Z)"
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ToolButton
        icon={Redo2}
        label="重做 (⇧⌘Z)"
        disabled={!canRedo}
        onClick={onRedo}
      />
      <ToolButton
        icon={Copy}
        label="複製 (⌘D)"
        disabled={!canCopy}
        onClick={onDuplicate}
      />
      <ToolButton
        icon={Trash2}
        label="刪除 (⌫)"
        disabled={!canDelete}
        onClick={onDelete}
      />
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className="rounded-xl"
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
