import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, RefreshCw, Check, X, Zap } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { buildStamp, drawPhotoStamp, ensureCoords, stampLines, startPhotoSensors } from "../lib/photoStamp";
import { Button } from "./ui/button";

const MAX_BYTES = 500 * 1024;

export async function compressImage(source, maxBytes = MAX_BYTES, stamp) {
  const bitmap = await createImageBitmap(source);
  let maxDim = 1280;
  let quality = 0.85;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (stamp) drawPhotoStamp(ctx, canvas.width, canvas.height, stamp);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (blob.size <= maxBytes) return blob;
    if (quality > 0.5) quality -= 0.15;
    else maxDim = Math.round(maxDim * 0.75);
  }
  throw new Error("Could not compress image under 500KB");
}

function StampHud({ stamp, testId }) {
  const lines = stampLines(stamp);
  const known = typeof stamp.heading === "number" && !Number.isNaN(stamp.heading);
  return (
    <div className="pointer-events-none absolute inset-0" data-testid={testId}>
      <div
        className="absolute left-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-black/40 text-[9px] font-semibold text-white"
        style={{ transform: known ? `rotate(${-stamp.heading}deg)` : undefined }}
      >
        <span className="absolute top-0.5">N</span>
        <span className="h-0 w-0 border-x-[4px] border-b-[12px] border-x-transparent border-b-rose-600" />
      </div>
      <div
        className="absolute bottom-3 right-3 max-w-[70%] text-right text-[11px] font-semibold leading-snug text-white"
        style={{ textShadow: "0 0 3px #000, 0 1px 2px #000" }}
      >
        {lines.map((line, i) => (
          <div key={`${i}-${line}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

export function CameraCapture({ open, onClose, onCapture, testId }) {
  const { t, lang } = useT();
  const { user } = useAuth();
  const videoRef = useRef();
  const streamRef = useRef();
  const fileRef = useRef();
  const sensorsRef = useRef({});
  const stampAtShotRef = useRef(null);
  const [shot, setShot] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  const [sensors, setSensors] = useState({});
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const stampLabels = useMemo(() => ({ gpsUnavailable: t("gps_unavailable"), msnm: t("msnm") }), [t]);
  const liveStamp = useMemo(
    () => buildStamp({ sensors, takenBy: user?.name, labels: stampLabels }),
    [sensors, user?.name, stampLabels]
  );

  useEffect(() => {
    sensorsRef.current = sensors;
  }, [sensors]);

  useEffect(() => {
    if (!open) return undefined;
    setShot(null);
    setPreviewUrl(null);
    stampAtShotRef.current = null;
    setNoCamera(false);
    setTorchSupported(false);
    setTorchOn(false);
    setSensors({});
    return startPhotoSensors((next) => setSensors(next), lang === "en" ? "en" : "id");
  }, [open, lang]);

  const videoTrack = () => streamRef.current?.getVideoTracks?.()[0];

  const applyTorch = async (on) => {
    const track = videoTrack();
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!open || isNative) return undefined;
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
        const track = stream.getVideoTracks()[0];
        let torch = false;
        try {
          torch = !!track?.getCapabilities?.()?.torch;
        } catch {
          torch = false;
        }
        setTorchSupported(torch);
      } catch {
        setNoCamera(true);
        setTorchSupported(false);
      }
    })();
    return () => {
      cancelled = true;
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (track) {
        try {
          if (track.getCapabilities?.()?.torch) {
            track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
          }
        } catch { /* ignore */ }
      }
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [open, isNative]);

  useEffect(() => {
    if (!open || !isNative || shot) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const photo = await CapCamera.getPhoto({
          quality: 90,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
          saveToGallery: false,
        });
        if (cancelled) return;
        const src = photo.webPath || (photo.path ? Capacitor.convertFileSrc(photo.path) : null);
        if (!src) throw new Error("no photo");
        const blob = await (await fetch(src)).blob();
        if (cancelled) return;
        setBusy(true);
        try {
          stampAtShotRef.current = await currentStamp();
        } finally {
          if (!cancelled) setBusy(false);
        }
        if (cancelled) return;
        setShot(blob);
        try {
          const preview = await compressImage(blob, MAX_BYTES, stampAtShotRef.current);
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(preview);
          });
        } catch {
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
        }
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => { cancelled = true; };
  }, [open, isNative, shot]);

  useEffect(() => {
    if (!open || shot || noCamera) return;
    const video = videoRef.current;
    if (video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
    }
  }, [open, shot, noCamera]);

  const toggleFlash = async () => {
    const next = !torchOn;
    const ok = await applyTorch(next);
    if (!ok) {
      setTorchOn(false);
      toast.error(t("flash_unavailable"));
      return;
    }
    setTorchOn(next);
  };

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const stampLang = lang === "en" ? "en" : "id";
  const currentStamp = async () => {
    const sensorsNow = await ensureCoords(sensorsRef.current, stampLang);
    sensorsRef.current = sensorsNow;
    return buildStamp({ sensors: sensorsNow, takenBy: user?.name, labels: stampLabels });
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0);
    canvas.toBlob(async (b) => {
      if (!b) return;
      stampAtShotRef.current = await currentStamp();
      setShot(b);
      try {
        const preview = await compressImage(b, MAX_BYTES, stampAtShotRef.current);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(preview);
        });
      } catch {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(b);
        });
      }
    }, "image/jpeg", 0.95);
  };

  const finish = async (blob) => {
    setBusy(true);
    try {
      const compressed = await compressImage(blob, MAX_BYTES, stampAtShotRef.current || await currentStamp());
      await onCapture(compressed);
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) {
      stampAtShotRef.current = await currentStamp();
      finish(f);
    }
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
        ) : (
          <>
            {!isNative && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover ${shot ? "hidden" : ""}`}
              />
            )}
            {!shot && !isNative && <StampHud stamp={liveStamp} testId={`${testId}-stamp-hud`} />}
            {isNative && !shot && <p className="px-8 text-center text-sm text-white/80">{busy ? t("compressing") : `${t("take_photo")}…`}</p>}
            {shot && <img src={previewUrl} alt="captured" className="max-h-full max-w-full object-contain" />}
          </>
        )}
      </div>
      <div className="flex items-center justify-center gap-6 p-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        {!noCamera && !shot && !isNative && (
          <>
            {torchSupported && (
              <button
                type="button"
                onClick={toggleFlash}
                aria-pressed={torchOn}
                aria-label={torchOn ? t("flash_on") : t("flash")}
                data-testid={`${testId}-camera-flash`}
                className={`flex h-12 w-12 items-center justify-center rounded-full bg-white/15 transition-colors ${torchOn ? "text-amber-300" : "text-white"}`}
              >
                <Zap className={`h-5 w-5 ${torchOn ? "fill-amber-300" : ""}`} />
              </button>
            )}
            <button onClick={capture} className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition-transform active:scale-95" aria-label={t("capture")} data-testid={`${testId}-camera-capture`} />
            {torchSupported && <span className="h-12 w-12" />}
          </>
        )}
        {shot && (
          <>
            <Button variant="outline" className="rounded-full border-white/40 bg-transparent text-white hover:bg-white/10" onClick={() => { stampAtShotRef.current = null; setShot(null); setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); }} disabled={busy} data-testid={`${testId}-camera-retake`}><RefreshCw className="mr-2 h-4 w-4" /> {t("retake")}</Button>
            <Button className="rounded-full" onClick={() => finish(shot)} disabled={busy} data-testid={`${testId}-camera-use`}><Check className="mr-2 h-4 w-4" /> {busy ? t("compressing") : t("use_photo")}</Button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
