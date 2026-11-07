import { useState } from 'react';
import { prepareImage, type PreparedImage } from '../lib/images';

const MAX_IMAGES = 6;

interface Props {
  images: PreparedImage[];
  setImages: (fn: (prev: PreparedImage[]) => PreparedImage[]) => void;
  busy: boolean;
  onBuild: () => void;
}

export function UploadStep({ images, setImages, busy, onBuild }: Props) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setProcessing(true);
    try {
      const room = MAX_IMAGES - images.length;
      const picked = [...files].slice(0, room);
      if (files.length > room) setError(`Up to ${MAX_IMAGES} photos at a time.`);
      const prepared = await Promise.all(picked.map(prepareImage));
      setImages((prev) => [...prev, ...prepared]);
    } catch {
      setError("Couldn't read one of those photos. Try another.");
    } finally {
      setProcessing(false);
    }
  };

  const full = images.length >= MAX_IMAGES;
  const pickerClass =
    'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 bg-white px-3 py-5 text-center font-medium text-stone-700 active:bg-stone-100';

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">1. Add recipe photos</h2>

      {!full && (
        <div className="flex gap-3">
          <label className={pickerClass}>
            <span aria-hidden>📷</span> Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <label className={pickerClass}>
            <span aria-hidden>🖼️</span> Choose photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {processing && <p className="text-sm text-stone-500">Preparing photos…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {images.map((img, i) => (
            <li key={img.id} className="relative">
              <img
                src={img.preview}
                alt={`Recipe photo ${i + 1}`}
                className="aspect-square w-full rounded-lg object-cover"
              />
              <button
                onClick={() => setImages((prev) => prev.filter((p) => p.id !== img.id))}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        disabled={!images.length || busy || processing}
        onClick={onBuild}
        className="w-full rounded-xl bg-emerald-600 py-3.5 text-lg font-semibold text-white shadow-sm active:bg-emerald-700 disabled:bg-stone-300"
      >
        {busy ? 'Reading recipes…' : `Build my list${images.length ? ` (${images.length} photo${images.length > 1 ? 's' : ''})` : ''}`}
      </button>
      {busy && <p className="text-center text-sm text-stone-500">This takes about 20–40 seconds.</p>}
    </section>
  );
}
