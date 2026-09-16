const keyFor = (userId) => `dt_inspection_drafts_${userId}`;

const readAll = (userId) => {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAll = (userId, drafts) => {
  localStorage.setItem(keyFor(userId), JSON.stringify(drafts));
};

export const listDrafts = (userId) =>
  readAll(userId).sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || "")));

export const getDraft = (userId, draftId) => readAll(userId).find((d) => d.id === draftId) || null;

export const upsertDraft = (userId, draft) => {
  if (!userId || !draft?.id) return null;
  const next = {
    ...draft,
    saved_at: new Date().toISOString(),
  };
  const rest = readAll(userId).filter((d) => d.id !== draft.id);
  writeAll(userId, [next, ...rest]);
  return next;
};

export const deleteDraft = (userId, draftId) => {
  if (!userId || !draftId) return;
  writeAll(userId, readAll(userId).filter((d) => d.id !== draftId));
};

export const formHasData = ({ truckId, typeId, kmHm, generalNote, results }) => {
  if (truckId || typeId || String(kmHm ?? "") !== "" || String(generalNote || "").trim()) return true;
  return Object.values(results || {}).some((r) => {
    if (!r) return false;
    if (r.status && r.status !== "OK") return true;
    if (String(r.note || "").trim()) return true;
    if ((r.photos || []).length) return true;
    return false;
  });
};

export const answersDirty = ({ generalNote, results }) => {
  if (String(generalNote || "").trim()) return true;
  return Object.values(results || {}).some((r) => {
    if (!r) return false;
    if (r.status && r.status !== "OK") return true;
    if (String(r.note || "").trim()) return true;
    if ((r.photos || []).length) return true;
    return false;
  });
};
