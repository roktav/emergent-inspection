import axios from "axios";
import { api, API, getRefreshToken, setRefreshToken, setToken } from "../api";
import { idbDelete, idbGetAll, idbPut } from "./idb";
import { deletePhotoBlob, getPhotoBlob, isLocalPhoto } from "./photos";
import { pullSnapshot, checklistFromSnapshot } from "./snapshot";

async function refreshAccess() {
  const rt = getRefreshToken();
  if (!rt) return;
  const { data } = await axios.post(`${API}/auth/refresh`, { refresh_token: rt });
  setToken(data.access_token);
  if (data.refresh_token) setRefreshToken(data.refresh_token);
}

export function newOutboxId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function listOutbox(userId) {
  const all = await idbGetAll("outbox");
  return all
    .filter((row) => !userId || row.userId === userId)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export async function enqueueInspection({ userId, payload, photoLocalIds, draftId }) {
  const row = {
    id: newOutboxId(),
    userId,
    draftId: draftId || null,
    payload,
    photoLocalIds: photoLocalIds || [],
    status: "queued",
    error: null,
    createdAt: new Date().toISOString(),
  };
  await idbPut("outbox", row);
  return row;
}

export async function removeOutbox(id) {
  await idbDelete("outbox", id);
}

export async function uploadLocalPhoto(localId) {
  const blob = await getPhotoBlob(localId);
  if (!blob) throw new Error(`Missing local photo ${localId}`);
  const fd = new FormData();
  fd.append("file", blob, "photo.jpg");
  const { data } = await api.post("/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
  return data.path;
}

export function rewritePhotos(results, pathByLocal) {
  return (results || []).map((r) => ({
    ...r,
    photos: (r.photos || []).map((p) => (isLocalPhoto(p) ? pathByLocal[p.localId] : p)).filter(Boolean),
  }));
}

function stripExcluded(payload, snapshot) {
  const cl = checklistFromSnapshot(snapshot, payload.truck_id, payload.inspection_type_id);
  if (!cl) return null;
  const allowed = new Set(cl.groups.flatMap((g) => g.items.map((i) => i.id)));
  const next = payload.results.filter((r) => allowed.has(r.item_id));
  if (next.length !== allowed.size) return null;
  return { ...payload, results: next };
}

let running = false;

export async function runOutboxSync() {
  if (running) return { ok: true, skipped: true };
  running = true;
  const errors = [];
  try {
    try {
      await refreshAccess();
    } catch {
      /* interceptor retries expired access tokens */
    }
    const snapshot = await pullSnapshot();
    const rows = (await listOutbox()).filter((r) => r.status !== "syncing");
    for (const row of rows) {
      const current = { ...row, status: "syncing", error: null };
      await idbPut("outbox", current);
      try {
        const pathByLocal = {};
        for (const localId of row.photoLocalIds || []) {
          pathByLocal[localId] = await uploadLocalPhoto(localId);
        }
        let payload = { ...row.payload, results: rewritePhotos(row.payload.results, pathByLocal) };
        try {
          await api.post("/inspections", payload);
        } catch (e) {
          const detail = e?.response?.data?.detail || "";
          if (e?.response?.status === 400 && /excluded/i.test(String(detail))) {
            const fresh = await pullSnapshot();
            const stripped = stripExcluded(payload, fresh);
            if (!stripped) throw e;
            payload = { ...payload, results: stripped.results };
            await api.post("/inspections", payload);
          } else {
            throw e;
          }
        }
        for (const localId of row.photoLocalIds || []) {
          await deletePhotoBlob(localId);
        }
        await removeOutbox(row.id);
      } catch (e) {
        const message = e?.response?.data?.detail || e?.message || "Sync failed";
        await idbPut("outbox", { ...row, status: "error", error: String(message) });
        errors.push({ id: row.id, error: String(message) });
      }
    }
    return { ok: errors.length === 0, errors, snapshot };
  } finally {
    running = false;
  }
}
