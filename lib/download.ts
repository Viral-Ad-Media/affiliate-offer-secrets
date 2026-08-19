// Client-side file download: build a Blob, click a temporary anchor. Used by the kit tabs'
// Download buttons — the content is already in the browser (the page rendered it), so a server
// export route would re-fetch what is on screen just to set one header.
export function downloadTextFile(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred so the click has consumed the URL before it is revoked — revoking synchronously
  // races the download start in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Filename-safe slug from a product/campaign title. */
export function filenameSlug(title: string | null | undefined, fallback = "kit"): string {
  const s = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}
