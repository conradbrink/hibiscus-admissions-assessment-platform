"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH, type Point, type Stroke } from "@/lib/registration/signature";

/**
 * A box the parent signs in with a finger, a pen or the mouse. The strokes
 * go to the server as JSON in a hidden field; the server validates them and
 * renders the SVG it stores. Points are kept in the fixed 600 × 200 box so
 * a signature looks the same whatever the screen size.
 */
export function SignaturePad({ name, error, disabled }: { name: string; error?: string; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const [value, setValue] = useState("");
  const [hasInk, setHasInk] = useState(false);

  const paint = () => {
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
    const sx = w / SIGNATURE_WIDTH;
    const sy = h / SIGNATURE_HEIGHT;
    // The baseline, like a paper form.
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.78);
    ctx.lineTo(w * 0.94, h * 0.78);
    ctx.stroke();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokesRef.current) {
      ctx.beginPath();
      const first = s[0];
      ctx.moveTo(first[0] * sx, first[1] * sy);
      if (s.length === 1) ctx.lineTo(first[0] * sx, first[1] * sy);
      for (let i = 1; i < s.length; i += 1) ctx.lineTo(s[i][0] * sx, s[i][1] * sy);
      ctx.stroke();
    }
  };

  useEffect(() => {
    paint();
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIGNATURE_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * SIGNATURE_HEIGHT;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const commit = () => {
    const strokes = strokesRef.current;
    setValue(strokes.length ? JSON.stringify(strokes) : "");
    setHasInk(strokes.length > 0);
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
    const p = toPoint(e);
    const last = stroke[stroke.length - 1];
    // Skip points that would not move the pen; keeps the payload small.
    if (Math.abs(p[0] - last[0]) < 0.8 && Math.abs(p[1] - last[1]) < 0.8) return;
    stroke.push(p);
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
    commit();
  };
  const clear = () => {
    strokesRef.current = [];
    commit();
    paint();
  };

  return (
    <div className="space-y-2">
      <div className={`relative overflow-hidden rounded-2xl border-2 bg-white ${error ? "border-destructive" : "border-border"}`} style={{ aspectRatio: `${SIGNATURE_WIDTH} / ${SIGNATURE_HEIGHT}` }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Signature box: sign here with your finger, pen or mouse"
          className="block h-full w-full touch-none select-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
        />
        {!hasInk ? <span className="pointer-events-none absolute inset-x-0 top-3 text-center text-sm text-muted-foreground">Sign here</span> : null}
      </div>
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Use your finger on a phone, or the mouse on a computer.</p>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={disabled || !hasInk}>
          Clear
        </Button>
      </div>
    </div>
  );
}
