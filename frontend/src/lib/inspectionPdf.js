import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { fetchFileObjectUrl } from "./api";

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = [35, 25, 21];
const MUTED = [110, 102, 96];
const ACCENT = [152, 167, 213];
const PHOTO_H = 28;

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
const minutes = (a, b) => (a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000)) : null);

const text = (value) => {
  if (value == null || value === "") return "-";
  return String(value)
    .replace(/[\u2012\u2013\u2014]/g, "-")
    .replace(/[^\u0000-\u00FF]/g, "?");
};

const loadPhoto = async (path) => {
  if (typeof path !== "string" || !path) return null;
  const url = await fetchFileObjectUrl(path);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("photo"));
      el.src = url;
    });
    const maxW = 900;
    const scale = Math.min(1, maxW / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.72), w: canvas.width, h: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
};

const itemRows = (rows, t) => rows.map((r, i) => [
  String(i + 1),
  text(r.item_name),
  text(t(r.status)),
  text(r.note),
  "",
]);

const drawTable = (doc, title, rows, photoLists, t, startY, emptyText, detailUrl) => {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  let y = startY < MARGIN ? MARGIN : startY;
  if (y > PAGE_H - 36) {
    doc.addPage();
    y = MARGIN;
  }
  doc.text(title, MARGIN, y);
  const lists = photoLists || [];
  autoTable(doc, {
    startY: y + 3,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    head: [["#", text(t("name")), text(t("status")), text(t("findings_note")), text(t("photos"))]],
    body: rows.length
      ? rows
      : [[{ content: text(emptyText), colSpan: 5, styles: { halign: "center", textColor: MUTED } }]],
    styles: { font: "helvetica", fontSize: 8, textColor: INK, cellPadding: 1.6, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: ACCENT, textColor: INK, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 22 }, 3: { cellWidth: 36 }, 4: { cellWidth: 34 } },
    theme: "grid",
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== 4 || !rows.length) return;
      const photos = lists[data.row.index] || [];
      data.cell.text = photos.length ? [""] : ["-"];
      if (photos.length) data.cell.styles.minCellHeight = 4 + photos.length * (PHOTO_H + 2);
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 4 || !rows.length) return;
      const photos = lists[data.row.index] || [];
      let imgY = data.cell.y + 1.5;
      const imgX = data.cell.x + 1.5;
      const maxW = data.cell.width - 3;
      photos.forEach((photo) => {
        const drawW = Math.min(maxW, PHOTO_H * (photo.w / photo.h));
        doc.addImage(photo.dataUrl, "JPEG", imgX, imgY, drawW, PHOTO_H);
        if (detailUrl) doc.link(imgX, imgY, drawW, PHOTO_H, { url: detailUrl });
        imgY += PHOTO_H + 1.5;
      });
    },
  });
  return doc.lastAutoTable.finalY + 8;
};

const loadRowPhotos = async (rows) => {
  const lists = [];
  for (const row of rows) {
    const loaded = [];
    for (const path of row.photos || []) {
      try {
        const photo = await loadPhoto(path);
        if (photo) loaded.push(photo);
      } catch {
        /* a missing file stays out of the cell */
      }
    }
    lists.push(loaded);
  }
  return lists;
};

export async function downloadInspectionPdf(insp, t) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ACCENT);
  doc.text(text(t("app_name")).toUpperCase(), MARGIN, y);

  y += 7;
  doc.setTextColor(...INK);
  doc.setFontSize(16);
  doc.text(text(t("inspection_detail")), MARGIN, y);

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const hull = text(insp.truck_hull_number);
  doc.text(hull, MARGIN, y);
  if (insp.truck_vin_number) {
    const hullW = doc.getTextWidth(hull);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(text(insp.truck_vin_number), MARGIN + hullW + 3, y);
  }

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const subtitle = [insp.inspection_date, insp.inspection_type_name].filter(Boolean).map(text).join("  ·  ");
  if (subtitle) doc.text(subtitle, MARGIN, y);

  y += 6;
  doc.setTextColor(...INK);
  const defectLine = insp.has_defect
    ? `${insp.defect_count} ${t("defects")}`
    : t("no_defects");
  doc.text(`${text(t(insp.status))}   ·   ${text(defectLine)}`, MARGIN, y);

  const detailUrl = `${window.location.origin}/inspections/${insp.id}`;
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 64, 175);
  const linkLabel = text(t("pdf_open_inspection"));
  doc.textWithLink(linkLabel, MARGIN, y, { url: detailUrl });
  doc.setDrawColor(30, 64, 175);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y + 0.8, MARGIN + doc.getTextWidth(linkLabel), y + 0.8);
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.textWithLink(detailUrl, MARGIN, y, { url: detailUrl });

  const mins = minutes(insp.started_at, insp.completed_at);
  const completed = mins != null ? `${fmt(insp.completed_at)} · ${mins} ${t("min")}` : fmt(insp.completed_at);
  y += 4;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: INK, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: "bold", textColor: MUTED, cellWidth: 38 }, 2: { fontStyle: "bold", textColor: MUTED, cellWidth: 38 } },
    body: [
      [text(t("km_hm")), text(insp.km_hm), text(t("inspection_type")), text(insp.inspection_type_name)],
      [text(t("driver_name")), text(insp.driver_name), text(t("started_at")), text(fmt(insp.started_at))],
      [text(t("completed_at")), text(completed), text(t("approval_admin")), text(insp.approved_by_name || t("pending"))],
      [text(t("approval")), text(fmt(insp.approved_at)), text(t("checked")), text(`${insp.total_items ?? insp.results?.length ?? 0} ${t("items")}`)],
    ],
  });
  y = doc.lastAutoTable.finalY + 4;

  const writeNote = (label, value) => {
    if (!value) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(text(`${label}: ${value}`), CONTENT_W);
    const block = lines.length * 4.2 + 4;
    if (y + block > PAGE_H - 16) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(lines, MARGIN, y + 4);
    y += block;
  };
  writeNote(t("general_note"), insp.general_note);
  writeNote(t("admin_note"), insp.admin_note);

  const results = insp.results || [];
  const defects = results.filter((r) => r.status !== "OK");
  const photosByRow = new Map();
  if (!insp.photos_purged_at) {
    const loaded = await loadRowPhotos(results);
    results.forEach((row, i) => photosByRow.set(row, loaded[i]));
  }
  const photosFor = (rows) => rows.map((row) => photosByRow.get(row) || []);
  y = drawTable(doc, text(`${t("defect_items")} (${defects.length})`), itemRows(defects, t), photosFor(defects), t, y + 2, t("no_defects"), detailUrl);
  y = drawTable(doc, text(`${t("all_items")} (${results.length})`), itemRows(results, t), photosFor(results), t, y, t("no_data"), detailUrl);

  if (insp.photos_purged_at) {
    if (y > PAGE_H - 24) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(text(t("photos_purged")), CONTENT_W);
    doc.text(lines, MARGIN, y + 4);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${i} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
  }

  const fileHull = String(insp.truck_hull_number || "unit").replace(/[^\w.-]+/g, "_");
  const filename = `inspeksi_${fileHull}_${insp.inspection_date || "report"}.pdf`;

  if (Capacitor.isNativePlatform()) {
    // The Android WebView has no download manager attached, so the <a download>
    // click below is silently a no-op inside the APK. Write the file to the app's
    // cache directory instead (already exposed to Android's FileProvider by
    // android/app/src/main/res/xml/file_paths.xml) and hand it to the system
    // share sheet, so the inspector can open it in a PDF viewer, save it to
    // Files/Drive, or send it on from the field.
    const dataUri = doc.output("datauristring");
    const base64 = dataUri.slice(dataUri.indexOf("base64,") + "base64,".length);
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title: filename, files: [uri], dialogTitle: filename });
    } catch (err) {
      const message = String(err?.message || err || "");
      if (/cancel/i.test(message)) return;
      throw err;
    }
    return;
  }

  const blob = doc.output("blob");
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}
