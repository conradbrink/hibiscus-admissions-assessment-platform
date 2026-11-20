/**
 * An item's photo: what is accepted, and the metadata taken out of it.
 *
 * A phone writes where a photo was taken into the photo itself (EXIF, in a
 * JPEG's APP1 segment). The phone's own re-encode on the item form already
 * drops it; `stripJpegMetadata` drops it again on the server, so a request
 * that skipped the form cannot store the storeroom's location. Pure; tested.
 */

/** The largest photo the server takes, after the phone has shrunk it. */
export const MAX_PHOTO_BYTES = 700 * 1024;
/** The long side the phone shrinks a photo to. */
export const PHOTO_MAX_SIDE = 1024;

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * The JPEG without its APP1 (EXIF, XMP) and APP13 (IPTC) segments, which is
 * where a camera writes the place, the time and the device. Everything else
 * is kept as it was, including the colour profile. Null when the bytes are
 * not a JPEG this can walk, which the caller refuses.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (!isJpeg(bytes)) return null;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes before a marker.
    if (bytes[i + 1] === 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === undefined) return null;
    // Start of scan: the picture itself, to the end, unchanged.
    if (marker === 0xda) {
      for (let j = i; j < bytes.length; j += 1) out.push(bytes[j]);
      return Uint8Array.from(out);
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return Uint8Array.from(out);
    }
    // Markers with no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 3 >= bytes.length) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return null;
    const drop = marker === 0xe1 || marker === 0xed;
    if (!drop) for (let j = i; j < i + 2 + length; j += 1) out.push(bytes[j]);
    i += 2 + length;
  }
  return null;
}

/** Where the console serves an item's photo; the version makes a new photo a new address. */
export function itemPhotoUrl(itemId: string, sha256: string | null | undefined): string | null {
  return sha256 ? `/staff/stores/inventory/${itemId}/photo?v=${sha256.slice(0, 16)}` : null;
}

/** PostgREST's text form of a bytea, and back. */
export function toByteaHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

export function fromByteaHex(value: string | null | undefined): Uint8Array | null {
  if (!value || !value.startsWith("\\x")) return null;
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}
