import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

const GEOCODE_CELL = 0.00045;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let geocodeCache = { key: "", lines: [] };

const pad = (n) => String(n).padStart(2, "0");

export const formatStampDate = (d = new Date()) =>
  `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;

export const formatCoords = (lat, lon) => {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
};

const geocodeKey = (lat, lon, lang) =>
  `${Math.round(lat / GEOCODE_CELL)},${Math.round(lon / GEOCODE_CELL)},${lang}`;

const uniqueJoin = (parts) => [...new Set(parts.filter(Boolean))].join(", ");

export const locationLinesFromGeocode = (data) => {
  const admin = data?.localityInfo?.administrative || [];
  const byLevel = {};
  admin.forEach((a) => {
    if (a?.adminLevel && a.name) byLevel[a.adminLevel] = a.name;
  });
  const province = data.principalSubdivision || byLevel[4] || "";
  const kabupaten = byLevel[5] || data.city || "";
  const kecamatan = byLevel[6] || byLevel[7] || data.locality || "";
  const line1 = uniqueJoin([kecamatan, kabupaten]);
  const line2 = province && province !== line1 ? province : "";
  return [line1, line2].filter(Boolean);
};

export async function reverseGeocode(lat, lon, lang = "id") {
  if (lat == null || lon == null) return [];
  const key = geocodeKey(lat, lon, lang);
  if (geocodeCache.key === key) return geocodeCache.lines;
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`;
    const res = await fetch(url);
    if (!res.ok) return geocodeCache.key === key ? geocodeCache.lines : [];
    const lines = locationLinesFromGeocode(await res.json());
    geocodeCache = { key, lines };
    return lines;
  } catch {
    return [];
  }
}

const headingFromOrientation = (event) => {
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading;
  }
  if (typeof event.alpha !== "number") return null;
  const orient = window.screen?.orientation?.angle || 0;
  return (360 - event.alpha + orient + 360) % 360;
};

const positionOptions = (high) => ({
  enableHighAccuracy: high,
  timeout: high ? 20000 : 15000,
  maximumAge: high ? 10000 : 60000,
  enableLocationFallback: true,
  interval: 4000,
  minimumUpdateInterval: 2000,
});

const emptyReading = () => ({
  lat: null,
  lon: null,
  altitude: null,
  heading: null,
  location: [],
});

let latestReading = emptyReading();
let sensorListeners = new Set();
let stopSensorWatch = null;
let sensorLang = "id";

const publishReading = (reading) => {
  latestReading = reading;
  sensorListeners.forEach((fn) => {
    try { fn(reading); } catch { /* a listener must not stop the watch */ }
  });
};

const hasCoords = (reading) => reading?.lat != null && reading?.lon != null;

const secureEnoughForWebGps = () =>
  typeof window !== "undefined" && window.isSecureContext && !!navigator.geolocation;

async function ensureLocationPermission() {
  if (!Capacitor.isNativePlatform()) return secureEnoughForWebGps();
  try {
    let status = await Geolocation.checkPermissions();
    if (status.location === "granted" || status.coarseLocation === "granted") return true;
    status = await Geolocation.requestPermissions();
    return status.location === "granted" || status.coarseLocation === "granted";
  } catch {
    // Location services can be off. Still start the watch so Android can ask to enable them.
    return true;
  }
}

function watchSensors() {
  let stopped = false;
  let watchId = null;
  let heading = latestReading.heading;
  let lat = latestReading.lat;
  let lon = latestReading.lon;
  let altitude = latestReading.altitude;
  let geoHeading = null;
  let location = latestReading.location || [];
  let geoSeq = 0;
  let triedCoarse = false;

  const snapshot = () => ({
    lat: lat ?? latestReading.lat,
    lon: lon ?? latestReading.lon,
    altitude: altitude ?? latestReading.altitude,
    heading: heading ?? geoHeading ?? latestReading.heading,
    location: location?.length ? location : latestReading.location,
  });

  const emit = () => {
    if (!stopped) publishReading(snapshot());
  };

  const onFix = (pos) => {
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
    altitude = pos.coords.altitude;
    geoHeading = typeof pos.coords.heading === "number" && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : null;
    emit();
    const seq = ++geoSeq;
    reverseGeocode(lat, lon, sensorLang).then((lines) => {
      if (stopped || seq !== geoSeq) return;
      location = lines;
      emit();
    });
  };

  const arm = async (high) => {
    if (stopped) return;
    let retired = false;
    let id;
    try {
      id = await Geolocation.watchPosition(positionOptions(high), (pos, err) => {
        if (stopped || retired) return;
        if (pos?.coords && pos.coords.latitude != null && pos.coords.longitude != null) {
          onFix(pos);
          return;
        }
        const denied = err?.code === 1 || err?.code === "OS-PLUG-GLOC-0003";
        if (err && high && !triedCoarse && !denied) {
          triedCoarse = true;
          retired = true;
          if (id) Geolocation.clearWatch({ id }).catch(() => {});
          arm(false);
        }
      });
    } catch {
      if (!stopped && high && !triedCoarse) {
        triedCoarse = true;
        arm(false);
      }
      return;
    }
    if (stopped || retired) {
      Geolocation.clearWatch({ id }).catch(() => {});
      return;
    }
    watchId = id;
  };

  ensureLocationPermission().then((ok) => {
    if (stopped || !ok) return;
    arm(true);
  });

  const onOrient = (event) => {
    const next = headingFromOrientation(event);
    if (next == null) return;
    heading = next;
    emit();
  };

  const startOrient = async () => {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch {
      /* permission denied — compass stays unused */
    }
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  };
  startOrient();
  emit();

  return () => {
    stopped = true;
    geoSeq += 1;
    if (watchId) Geolocation.clearWatch({ id: watchId }).catch(() => {});
    window.removeEventListener("deviceorientationabsolute", onOrient, true);
    window.removeEventListener("deviceorientation", onOrient, true);
  };
}

export function startPhotoSensors(onChange, lang = "id") {
  sensorLang = lang || "id";
  sensorListeners.add(onChange);
  onChange(latestReading);
  if (!stopSensorWatch) stopSensorWatch = watchSensors();
  return () => {
    sensorListeners.delete(onChange);
    if (sensorListeners.size === 0 && stopSensorWatch) {
      const stop = stopSensorWatch;
      stopSensorWatch = null;
      stop();
    }
  };
}

export async function ensureCoords(sensors, lang = "id") {
  sensorLang = lang || sensorLang;
  const current = hasCoords(sensors) ? sensors : latestReading;
  if (hasCoords(current)) {
    if ((current.location || []).length) return current;
    const location = await reverseGeocode(current.lat, current.lon, sensorLang);
    const next = { ...latestReading, ...current, location };
    publishReading(next);
    return next;
  }
  if (!Capacitor.isNativePlatform() && !secureEnoughForWebGps()) return current || emptyReading();
  const allowed = await ensureLocationPermission();
  if (!allowed) return current || emptyReading();
  let pos = null;
  try {
    pos = await Geolocation.getCurrentPosition({ ...positionOptions(true), timeout: 8000, maximumAge: 30000 });
  } catch {
    try {
      pos = await Geolocation.getCurrentPosition({ ...positionOptions(false), timeout: 8000, maximumAge: 120000 });
    } catch {
      pos = null;
    }
  }
  if (pos?.coords?.latitude == null || pos?.coords?.longitude == null) return current || emptyReading();
  const geoHeading = typeof pos.coords.heading === "number" && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : null;
  const location = await reverseGeocode(pos.coords.latitude, pos.coords.longitude, sensorLang);
  const next = {
    ...latestReading,
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    altitude: pos.coords.altitude,
    heading: latestReading.heading ?? geoHeading,
    location,
  };
  publishReading(next);
  return next;
}

export const stampLines = (stamp) => {
  const labels = stamp.labels || {};
  const lines = [stamp.datetime || formatStampDate()];
  if (stamp.lat != null && stamp.lon != null) lines.push(formatCoords(stamp.lat, stamp.lon));
  else lines.push(labels.gpsUnavailable || "GPS unavailable");
  (stamp.location || []).slice(0, 2).forEach((line) => lines.push(line));
  const alt = stamp.altitude != null && !Number.isNaN(Number(stamp.altitude))
    ? `${Number(stamp.altitude).toFixed(1)} ${labels.msnm || "m"}`
    : `— ${labels.msnm || "m"}`;
  lines.push(stamp.takenBy ? `${alt} · ${stamp.takenBy}` : alt);
  return lines;
};

const drawStroked = (ctx, text, x, y) => {
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
};

const drawCompass = (ctx, cx, cy, r, heading) => {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.08);
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  const known = typeof heading === "number" && !Number.isNaN(heading);
  if (known) ctx.rotate((-heading * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(0, -r * 0.62);
  ctx.lineTo(r * 0.13, r * 0.08);
  ctx.lineTo(-r * 0.13, r * 0.08);
  ctx.closePath();
  ctx.fillStyle = "#e11d48";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, r * 0.58);
  ctx.lineTo(r * 0.1, -r * 0.02);
  ctx.lineTo(-r * 0.1, -r * 0.02);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = Math.max(2, r * 0.1);
  ctx.font = `600 ${Math.max(8, r * 0.42)}px Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawStroked(ctx, "N", 0, -r * 0.78);
  ctx.restore();
};

export function drawPhotoStamp(ctx, width, height, stamp) {
  if (!stamp) return;
  const min = Math.min(width, height);
  const pad = Math.max(10, Math.round(min * 0.028));
  const compassR = Math.max(14, Math.min(32, Math.round(min * 0.026)));
  drawCompass(ctx, pad + compassR, pad + compassR, compassR, stamp.heading);

  const lines = stampLines(stamp);
  const fontPx = Math.max(11, Math.min(17, Math.round(min * 0.0165)));
  ctx.save();
  ctx.font = `600 ${fontPx}px Roboto, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.82)";
  ctx.lineWidth = Math.max(2.4, fontPx * 0.22);
  ctx.lineJoin = "round";
  const lineH = fontPx * 1.28;
  const x = width - pad;
  let y = height - pad;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    drawStroked(ctx, lines[i], x, y);
    y -= lineH;
  }
  ctx.restore();
}

export const buildStamp = ({ sensors, takenBy, labels }) => ({
  datetime: formatStampDate(),
  lat: sensors?.lat ?? null,
  lon: sensors?.lon ?? null,
  altitude: sensors?.altitude ?? null,
  heading: sensors?.heading ?? null,
  location: sensors?.location || [],
  takenBy: takenBy || "",
  labels: labels || {},
});
