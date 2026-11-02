"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import type { Rect } from "@/lib/engine/image/framing";
import type { FramingInfo } from "@/lib/engine/pipeline";
import type { DocumentKind } from "@/lib/engine/types";

/**
 * Manual framing. The frame keeps the required proportions; drag it to move,
 * use the slider to resize. Parts of the frame outside the photo are filled
 * with the background colour.
 */
export function CropEditor({
  open,
  onOpenChange,
  framing,
  kind,
  onApply,
  onAuto,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  framing: FramingInfo;
  kind: DocumentKind;
  onApply: (rect: Rect) => void;
  onAuto: () => void;
}) {
  const { sourceWidth: W, sourceHeight: H } = framing;
  const aspect = framing.aspect ?? (framing.rect.w * W) / (framing.rect.h * H);
  const [rect, setRect] = useState<Rect>(framing.rect);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; rect: Rect } | null>(null);

  useEffect(() => {
    if (open) setRect(framing.rect);
  }, [open, framing.rect]);

  const clampCentre = (r: Rect): Rect => {
    const cx = Math.min(1, Math.max(0, r.x + r.w / 2));
    const cy = Math.min(1, Math.max(0, r.y + r.h / 2));
    return { ...r, x: cx - r.w / 2, y: cy - r.h / 2 };
  };

  const resize = (h: number) => {
    setRect((r) => {
      const w = (h * H * aspect) / W;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      return clampCentre({ x: cx - w / 2, y: cy - h / 2, w, h });
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, rect };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !imgRef.current) return;
    const box = imgRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / box.width;
    const dy = (e.clientY - drag.current.y) / box.height;
    setRect(clampCentre({ ...drag.current.rect, x: drag.current.rect.x + dx, y: drag.current.rect.y + dy }));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setRect((r) => clampCentre({ ...r, x: r.x + m[0], y: r.y + m[1] }));
  };

  const headShare = aspect >= 0.95 ? 0.6 : 0.7;
  const topMargin = aspect >= 0.95 ? 0.13 : 0.09;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Adjust the framing" description="Drag the frame to move it. Use the slider to change its size. The proportions stay as required." wide>
        <div className="grid place-items-center overflow-hidden rounded-[10px] bg-ink/90 px-10 py-8">
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={framing.sourceUrl} alt="Original photo" className="block max-h-[52vh] max-w-full select-none" draggable={false} />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Frame position"
              aria-valuetext={`Frame at ${Math.round((rect.x + rect.w / 2) * 100)}% across, ${Math.round((rect.y + rect.h / 2) * 100)}% down`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onKeyDown={onKeyDown}
              className="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgb(15_31_75/0.6)] outline-none focus-visible:border-marker"
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            >
              {kind === "photo" ? (
                <div
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%] border border-dashed border-marker/90"
                  style={{ top: `${topMargin * 100}%`, height: `${headShare * 100}%`, width: `${((headShare * 0.74) / aspect) * 100}%` }}
                  aria-hidden
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3" aria-hidden>
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="border-[0.5px] border-white/25" />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label htmlFor="frame-size" className="text-sm font-semibold text-ink">
            Frame size
          </label>
          <input
            id="frame-size"
            type="range"
            min={0.15}
            max={1.4}
            step={0.005}
            value={rect.h}
            onChange={(e) => resize(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-pen"
          />
        </div>
        {kind === "photo" ? <p className="mt-2 text-xs text-ink-3">Fit the head inside the dashed oval, from the top of the hair to the chin.</p> : null}
        <DialogFooter className="justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              onAuto();
              onOpenChange(false);
            }}
          >
            Use automatic framing
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onApply(rect);
                onOpenChange(false);
              }}
            >
              Apply framing
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
