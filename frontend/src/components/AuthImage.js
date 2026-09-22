import { useEffect, useState } from "react";
import { fetchFileObjectUrl } from "../lib/api";
import { getPhotoObjectUrl, isLocalPhoto } from "../lib/offline/photos";

export function AuthImage({ path, alt = "", className, openable = false, testId }) {
  const [src, setSrc] = useState(null);
  const localId = isLocalPhoto(path) ? path.localId : null;

  useEffect(() => {
    let cancelled = false;
    let url = null;
    const loader = localId ? getPhotoObjectUrl(localId) : fetchFileObjectUrl(path);
    loader
      .then((next) => {
        if (!next) return;
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        url = next;
        setSrc(next);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, localId]);

  const img = src ? <img src={src} alt={alt} className={className} /> : <span className={`block bg-muted ${className || ""}`} />;

  if (!openable) return img;

  return (
    <button
      type="button"
      className="block overflow-hidden rounded-md border"
      disabled={!src}
      data-testid={testId}
      onClick={() => {
        if (!src) return;
        if (localId) {
          window.open(src, "_blank", "noopener,noreferrer");
          return;
        }
        fetchFileObjectUrl(path).then((url) => window.open(url, "_blank", "noopener,noreferrer"));
      }}
    >
      {img}
    </button>
  );
}
