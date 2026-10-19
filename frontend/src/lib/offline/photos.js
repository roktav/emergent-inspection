import { idbDelete, idbGet, idbSet } from "./idb";

export const isLocalPhoto = (p) => !!(p && typeof p === "object" && p.localId);

export function newLocalId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function savePhotoBlob(blob) {
  const localId = newLocalId();
  await idbSet("photos", localId, blob);
  return { localId };
}

export async function getPhotoBlob(localId) {
  return idbGet("photos", localId);
}

export async function getPhotoObjectUrl(localId) {
  const blob = await getPhotoBlob(localId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function deletePhotoBlob(localId) {
  await idbDelete("photos", localId);
}

export function collectLocalIds(results) {
  const ids = [];
  Object.values(results || {}).forEach((r) => {
    (r?.photos || []).forEach((p) => {
      if (isLocalPhoto(p)) ids.push(p.localId);
    });
  });
  return ids;
}
