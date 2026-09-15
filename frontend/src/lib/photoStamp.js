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

export function startPhotoSensors(onChange, lang = "id") {
  let watchId = null;
  let heading = null;
  let lat = null;
  let lon = null;
  let altitude = null;
  let geoHeading = null;
  let location = [];
  let geoSeq = 0;

  const emit = () => {
    onChange({
      lat,
      lon,
      altitude,
      heading: heading ?? geoHeading,
      location,
    });
  };

  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        altitude = pos.coords.altitude;
        geoHeading = typeof pos.coords.heading === "number" && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : null;
        emit();
        const seq = ++geoSeq;
        reverseGeocode(lat, lon, lang).then((lines) => {
          if (seq !== geoSeq) return;
          location = lines;
          emit();
        });
      },
      () => emit(),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 }
    );
  }

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
    geoSeq += 1;
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    window.removeEventListener("deviceorientationabsolute", onOrient, true);
    window.removeEventListener("deviceorientation", onOrient, true);
  };
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
