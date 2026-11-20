"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PHOTO_BYTES, PHOTO_MAX_SIDE } from "@/lib/stores/photo";

type Prepared = { file: File; url: string; width: number; height: number };

/**
 * Redraws a photo at most 1,024 px on its long side as a JPEG. Every photo
 * goes through this, however small: drawing it onto a canvas and encoding
 * it again is what drops the location and device details a phone writes
 * into the picture, and it turns an iPhone's HEIC into something every
 * browser shows.
 */
async function prepare(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // A transparent PNG would turn black as a JPEG; give it the page's white.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let quality = 0.82;
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  while (blob && blob.size > MAX_PHOTO_BYTES && quality > 0.45) {
    quality -= 0.12;
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  }
  if (!blob || blob.size === 0 || blob.size > MAX_PHOTO_BYTES) throw new Error("too large");
  const out = new File([blob], "item-photo.jpg", { type: "image/jpeg" });
  return { file: out, url: URL.createObjectURL(out), width, height };
}

/**
 * A photo of the item, taken there and then. "Take a photo" opens the
 * phone's camera straight away; "Choose a photo" opens the library, or the
 * file picker on a computer. The prepared JPEG is put into a hidden file
 * field so the form submits it like any other field.
 */
export function ItemPhotoField({ currentUrl }: { currentUrl?: string | null }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const carrierRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (prepared) URL.revokeObjectURL(prepared.url);
  }, [prepared]);

  const onPicked = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await prepare(file);
      const carrier = carrierRef.current;
      if (!carrier || typeof DataTransfer === "undefined") throw new Error("no carrier");
      const dt = new DataTransfer();
      dt.items.add(p.file);
      carrier.files = dt.files;
      setPrepared(p);
      setRemoved(false);
    } catch {
      setError("That photo could not be used. Try taking it again.");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    if (carrierRef.current) carrierRef.current.value = "";
    setPrepared(null);
    setRemoved(Boolean(currentUrl));
  };

  const shown = prepared?.url ?? (removed ? null : currentUrl ?? null);

  return (
    <div className="space-y-2">
      <input ref={carrierRef} type="file" name="photo" accept="image/jpeg" className="hidden" tabIndex={-1} aria-hidden />
      {prepared ? (
        <>
          <input type="hidden" name="photoWidth" value={prepared.width} />
          <input type="hidden" name="photoHeight" value={prepared.height} />
        </>
      ) : null}
      {removed && !prepared ? <input type="hidden" name="removePhoto" value="1" /> : null}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPicked(e.currentTarget)} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPicked(e.currentTarget)} />

      <div className="flex items-center gap-3">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted sm:size-28">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview or a private, session-checked route; nothing for the optimiser to do
            <img src={shown} alt="The item" className="size-full object-cover" />
          ) : (
            <Camera className="size-7 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Button type="button" variant="outline" className="h-12 justify-start text-base sm:h-9 sm:text-sm" onClick={() => cameraRef.current?.click()} disabled={busy}>
            <Camera aria-hidden /> {busy ? "Preparing…" : shown ? "Take a new photo" : "Take a photo"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="h-11 flex-1 justify-start text-sm sm:h-8" onClick={() => libraryRef.current?.click()} disabled={busy}>
              <ImagePlus aria-hidden /> Choose a photo
            </Button>
            {shown ? (
              <Button type="button" variant="ghost" className="h-11 text-sm text-destructive sm:h-8" onClick={clear} disabled={busy}>
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
