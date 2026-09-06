import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, RefreshCw, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useT } from "../lib/i18n";
import { Button } from "./ui/button";

const MAX_BYTES = 500 * 1024;

export async function compressImage(source, maxBytes = MAX_BYTES) {
  const bitmap = await createImageBitmap(source);
  let maxDim = 1280;
  let quality = 0.85;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (blob.size <= maxBytes) return blob;
    if (quality > 0.5) quality -= 0.15;
    else maxDim = Math.round(maxDim * 0.75);
  }
  throw new Error("Could not compress image under 500KB");
}

export function CameraCapture({ open, onClose, onCapture, testId }) {
  const { t } = useT();
  const videoRef = useRef();
  const streamRef = useRef();
  const fileRef = useRef();
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noCamera, setNoCamera] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShot(null);
    setNoCamera(false);
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        setNoCamera(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [open]);

  const capture = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0);
    canvas.toBlob((b) => setShot(b), "image/jpeg", 0.95);
  };

  const finish = async (blob) => {
    setBusy(true);
    try {
      const compressed = await compressImage(blob);
      await onCapture(compressed);
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) finish(f);
  };

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black" data-testid={`${testId}-camera`}>
      <div className="flex items-center justify-between p-3 text-white">
        <span className="font-heading text-sm font-semibold">{t("take_photo")}</span>
        <button onClick={onClose} className="rounded-full bg-white/15 p-2" data-testid={`${testId}-camera-close`}><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {noCamera ? (
          <div className="px-8 text-center text-white/80">
            <p className="text-sm">{t("camera_error")}</p>
            <Button className="mt-4 rounded-full" onClick={() => fileRef.current?.click()} data-testid={`${testId}-camera-fallback`}><Camera className="mr-2 h-4 w-4" /> {t("take_photo")}</Button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} data-testid={`${testId}-camera-input`} />
          </div>
        ) : shot ? (
          <img src={URL.createObjectURL(shot)} alt="captured" className="max-h-full max-w-full object-contain" />
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex items-center justify-center gap-6 p-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        {!noCamera && !shot && (
          <button onClick={capture} className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition-transform active:scale-95" aria-label={t("capture")} data-testid={`${testId}-camera-capture`} />
        )}
        {shot && (
          <>
            <Button variant="outline" className="rounded-full border-white/40 bg-transparent text-white hover:bg-white/10" onClick={() => setShot(null)} disabled={busy} data-testid={`${testId}-camera-retake`}><RefreshCw className="mr-2 h-4 w-4" /> {t("retake")}</Button>
            <Button className="rounded-full" onClick={() => finish(shot)} disabled={busy} data-testid={`${testId}-camera-use`}><Check className="mr-2 h-4 w-4" /> {busy ? t("compressing") : t("use_photo")}</Button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
