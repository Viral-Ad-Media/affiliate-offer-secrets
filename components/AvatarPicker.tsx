"use client";

import { useRef, useState } from "react";
import { Trash2, Upload, User } from "lucide-react";

// Downscale + re-encode client-side before anything is sent. The DB caps avatar_url length, so
// without this a normal phone photo (several MB) would just be rejected — the resize is what makes
// "pick any photo" actually work. Re-encoding to JPEG also normalises away formats the server
// allowlist rejects (HEIC, SVG) and strips EXIF, including GPS coordinates, as a side effect.
const MAX_DIM = 256;
const JPEG_QUALITY = 0.85;

async function toSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  // Centre-crop to a square first so the avatar isn't distorted by a non-square source.
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = MAX_DIM;
  canvas.height = MAX_DIM;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process this image");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, MAX_DIM, MAX_DIM);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function initialsOf(first: string | null, last: string | null, email: string): string {
  const a = first?.trim()?.[0] ?? "";
  const b = last?.trim()?.[0] ?? "";
  const both = (a + b).toUpperCase();
  return both || (email.trim()[0] ?? "?").toUpperCase();
}

export default function AvatarPicker({
  value,
  initials,
  onChange,
}: {
  value: string | null;
  initials: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await toSquareDataUrl(file));
    } catch {
      setError("Couldn't read that image. Try a PNG or JPEG.");
    } finally {
      setBusy(false);
      // Reset so re-picking the same file still fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-600 bg-ink-800">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing for
          // next/image to optimise.
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : initials ? (
          <span className="font-heading text-lg font-semibold text-zinc-400">{initials}</span>
        ) : (
          <User className="h-6 w-6 text-zinc-500" />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? "Processing…" : value ? "Replace" : "Upload photo"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Square crop, resized to {MAX_DIM}px. Saved when you save the profile.
        </p>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => pick(e.target.files?.[0])}
        className="hidden"
      />
    </div>
  );
}
