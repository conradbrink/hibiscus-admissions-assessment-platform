"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DRAWING_WIDTH, drawingHeight, inkLength, minimumInk, type Drawing, type Point, type Stroke } from "@/lib/stores/signature";
import { cn } from "@/lib/utils";

/**
 * The box an employee signs in, with a finger, a stylus or the mouse.
 *
 * Tall on a phone and wide on a laptop: the drawing records the box it was
 * made in (`{ w: 600, h, strokes }`, `h` in proportion to the pad), so it
 * replays exactly as drawn wherever it is shown. The strokes go to the parent
 * as numbers; the server checks them and renders the picture itself.
 *
 * Two buttons, as the school asked: Clear signature wipes the box, and Sign
 * again wipes it and asks for a fresh signature, for when the employee wants
 * another go at one that is already there.
 */
export function StoresSignaturePad({
  onChange,
  disabled,
  error,
}: {
  onChange: (drawing: Drawing | null) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const boxRef = useRef<{ w: number; h: number }>({ w: DRAWING_WIDTH, h: 200 });
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [hint, setHint] = useState("Sign here");

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = w / boxRef.current.w;
    const sy = h / boxRef.current.h;
    // The line to sign on, as on a paper form.
    ctx.strokeStyle = "rgba(23,32,51,0.22)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.76);
    ctx.lineTo(w * 0.94, h * 0.76);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokesRef.current) {
      ctx.beginPath();
      ctx.moveTo(s[0][0] * sx, s[0][1] * sy);
      if (s.length === 1) ctx.lineTo(s[0][0] * sx, s[0][1] * sy);
      for (let i = 1; i < s.length; i += 1) ctx.lineTo(s[i][0] * sx, s[i][1] * sy);
      ctx.stroke();
    }
  }, []);

  const emit = useCallback(() => {
    const strokes = strokesRef.current;
    setHasInk(strokes.length > 0);
    // Too little ink is reported as no signature, so Confirm stays off until
    // there is something the server will accept.
    onChange(strokes.length && inkLength(strokes) >= minimumInk(boxRef.current.w) ? { ...boxRef.current, strokes: strokes.map((s) => s.slice()) } : null);
  }, [onChange]);

  const clear = useCallback(
    (nextHint = "Sign here") => {
      strokesRef.current = [];
      setHint(nextHint);
      emit();
      paint();
    },
    [emit, paint]
  );

  // The box follows the pad's shape. If the phone is turned mid-signature the
  // shape changes, and stretching what was drawn would distort it, so the
  // pad starts again and says why.
  useEffect(() => {
    const measure = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const h = drawingHeight(canvas.clientWidth, canvas.clientHeight);
      const changed = Math.abs(h - boxRef.current.h) > 2;
      boxRef.current = { w: DRAWING_WIDTH, h };
      if (changed && strokesRef.current.length) clear("The screen changed shape. Please sign again.");
      else paint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [clear, paint]);

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { w, h } = boxRef.current;
    const x = Math.min(w, Math.max(0, ((e.clientX - rect.left) / rect.width) * w));
    const y = Math.min(h, Math.max(0, ((e.clientY - rect.top) / rect.height) * h));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([toPoint(e)]);
    paint();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    // A pen reports every point it passed through; use them all, so a fast
    // flourish on a phone is not cut into straight lines.
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const samples = events.length ? events : [e.nativeEvent];
    for (const ev of samples) {
      const p = toPoint({ ...e, clientX: ev.clientX, clientY: ev.clientY } as React.PointerEvent<HTMLCanvasElement>);
      const last = stroke[stroke.length - 1];
      if (Math.abs(p[0] - last[0]) < 0.8 && Math.abs(p[1] - last[1]) < 0.8) continue;
      stroke.push(p);
    }
    paint();
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Capture already released.
    }
    emit();
  };

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className={cn(
          "relative h-64 overflow-hidden rounded-2xl border-2 bg-white sm:h-60 md:h-56",
          error ? "border-destructive" : hasInk ? "border-primary/60" : "border-dashed border-input"
        )}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Signature box: sign here with your finger, a stylus or the mouse"
          data-testid="signature-pad"
          className={cn("block h-full w-full touch-none select-none", disabled ? "cursor-not-allowed" : "cursor-crosshair")}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {!hasInk ? (
          <span className="pointer-events-none absolute inset-x-0 top-4 text-center text-base text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-12 text-base md:h-10 md:text-sm" onClick={() => clear()} disabled={disabled || !hasInk}>
          <Eraser aria-hidden /> Clear signature
        </Button>
        <Button type="button" variant="outline" className="h-12 text-base md:h-10 md:text-sm" onClick={() => clear("Please sign again")} disabled={disabled || !hasInk}>
          <RotateCcw aria-hidden /> Sign again
        </Button>
      </div>
    </div>
  );
}
