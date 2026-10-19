import { api } from "../api";
import { idbGet, idbSet } from "./idb";

const SNAP_KEY = "snapshot";
const SYNCED_KEY = "lastSyncedAt";

export async function getSnapshot() {
  return (await idbGet("meta", SNAP_KEY)) || null;
}

export async function getLastSyncedAt() {
  return (await idbGet("meta", SYNCED_KEY)) || null;
}

export async function saveSnapshot(data) {
  await idbSet("meta", SNAP_KEY, data);
  await idbSet("meta", SYNCED_KEY, data?.generated_at || new Date().toISOString());
  return data;
}

export async function pullSnapshot() {
  const { data } = await api.get("/sync/field");
  await saveSnapshot(data);
  return data;
}

export function checklistFromSnapshot(snapshot, truckId, typeId) {
  if (!snapshot?.checklists) return null;
  const row = snapshot.checklists.find((c) => c.truck_id === truckId && c.inspection_type_id === typeId);
  if (!row) return null;
  return { truck: row.truck, groups: row.groups };
}

export function activeTrucks(snapshot) {
  return (snapshot?.trucks || []).filter((t) => t.is_active !== false);
}

export function activeTypes(snapshot) {
  return (snapshot?.inspection_types || []).filter((t) => t.is_active !== false);
}
