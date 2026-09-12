import { scaleStep } from "@/lib/geometry";

export function ScaleBar({ k }: { k: number }) {
  const cm = scaleStep(k);
  const px = cm * k;
  return (
    <div className="fixed right-6 bottom-6 z-10 flex flex-col gap-1.5 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground tabular-nums shadow-lg backdrop-blur-md">
      <div
        className="h-1.5 border-x border-b border-foreground/70"
        style={{ width: px }}
      />
      <span>{cm} cm</span>
    </div>
  );
}
