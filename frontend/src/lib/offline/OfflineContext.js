import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../i18n";
import { errMsg } from "../api";
import { isOfflineRole, isOnline, subscribeNetwork } from "./network";
import { getLastSyncedAt, getSnapshot, pullSnapshot } from "./snapshot";
import { listOutbox, runOutboxSync } from "./outbox";

const OfflineCtx = createContext(null);

export function OfflineProvider({ children }) {
  const { user } = useAuth();
  const { t } = useT();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [snapshot, setSnapshot] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [pending, setPending] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const userId = user?.id;
  const field = isOfflineRole(user?.role);

  const reloadLocal = useCallback(async () => {
    setSnapshot(await getSnapshot());
    setLastSyncedAt(await getLastSyncedAt());
    if (userId) setPending(await listOutbox(userId));
    else setPending([]);
  }, [userId]);

  useEffect(() => {
    reloadLocal();
  }, [reloadLocal]);

  useEffect(() => subscribeNetwork(setOnline), []);

  const sync = useCallback(async ({ quiet } = {}) => {
    if (!field || !userId) return;
    if (!(await isOnline())) {
      if (!quiet) toast.error(t("sync_offline"));
      return;
    }
    setSyncing(true);
    try {
      const result = await runOutboxSync();
      await reloadLocal();
      if (!quiet) {
        if (result.errors?.length) toast.error(result.errors[0].error);
        else toast.success(t("sync_done"));
      }
    } catch (e) {
      if (!quiet) toast.error(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }, [field, userId, reloadLocal, t]);

  useEffect(() => {
    if (!field || !userId || !online) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listOutbox(userId);
        if (cancelled) return;
        if (rows.length) await sync({ quiet: true });
        else {
          const data = await pullSnapshot();
          if (!cancelled) {
            setSnapshot(data);
            setLastSyncedAt(data.generated_at);
          }
        }
      } catch {
        /* keep last snapshot */
      }
    })();
    return () => { cancelled = true; };
  }, [field, userId, online, sync]);

  const value = useMemo(
    () => ({ online, snapshot, lastSyncedAt, pending, syncing, sync, reloadLocal, field }),
    [online, snapshot, lastSyncedAt, pending, syncing, sync, reloadLocal, field],
  );
  return <OfflineCtx.Provider value={value}>{children}</OfflineCtx.Provider>;
}

export const useOffline = () => useContext(OfflineCtx) || {
  online: true,
  snapshot: null,
  lastSyncedAt: null,
  pending: [],
  syncing: false,
  sync: async () => {},
  reloadLocal: async () => {},
  field: false,
};
