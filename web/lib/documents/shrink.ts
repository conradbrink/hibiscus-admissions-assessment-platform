/**
 * Browser-side: a phone photo is often 4 to 12 MB; the school needs a
 * readable scan, not a poster. Images above the threshold are redrawn at
 * most 2,000 px on the long side as JPEG. PDFs and small images pass
 * through untouched. HEIC (an iPhone default) is converted when the browser
 * can decode it; otherwise the original goes up and the server refuses it
 * with the "PDF, JPEG or PNG" message.
 */
export const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const MAX_SIDE_PX = 2000;

export type PreparedFile = { blob: Blob; filename: string; type: string };

function isImage(file: File): boolean {
  return /^image\//.test(file.type) || /\.(heic|heif|jpe?g|png)$/i.test(file.name);
}

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export async function prepareForUpload(file: File): Promise<PreparedFile> {
  const passThrough = { blob: file, filename: file.name, type: file.type };
  if (!isImage(file)) return passThrough;
  if (file.size <= SHRINK_ABOVE_BYTES && !isHeic(file)) return passThrough;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return passThrough;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return passThrough;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size === 0) return passThrough;
    // Only worth it when it actually got smaller (a tiny PNG re-encoded as JPEG might not).
    if (!isHeic(file) && blob.size >= file.size) return passThrough;
    return { blob, filename: file.name.replace(/\.(heic|heif|png|jpe?g)$/i, "") + ".jpg", type: "image/jpeg" };
  } catch {
    return passThrough;
  }
}
