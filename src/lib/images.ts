const MAX_EDGE = 1568; // Claude's sweet spot for vision; larger gets downscaled anyway
const QUALITY = 0.8;

export interface PreparedImage {
  id: string;
  mediaType: 'image/jpeg';
  data: string; // base64, no data: prefix
  preview: string; // object URL for thumbnails
}

/** Resize + re-encode on the client so uploads stay small (also converts HEIC on iOS). */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', QUALITY),
  );
  const data = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
  return { id: crypto.randomUUID(), mediaType: 'image/jpeg', data, preview: URL.createObjectURL(blob) };
}
