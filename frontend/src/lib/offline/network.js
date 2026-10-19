import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

// Who may queue a walk-around offline. Distinct from backend FIELD_ROLES,
// which only limits list/detail/dashboard to the user's own records.
// company_admin and superadmin stay online-only.
export const OFFLINE_ROLES = ["driver", "mechanic", "site_admin"];
export const isOfflineRole = (role) => OFFLINE_ROLES.includes(role);

export async function isOnline() {
  try {
    if (Capacitor.isNativePlatform()) {
      const status = await Network.getStatus();
      return !!status.connected;
    }
  } catch {
    /* fall through */
  }
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function subscribeNetwork(handler) {
  const wrap = () => { isOnline().then(handler); };
  window.addEventListener("online", wrap);
  window.addEventListener("offline", wrap);
  let handle;
  if (Capacitor.isNativePlatform()) {
    Network.addListener("networkStatusChange", (s) => handler(!!s.connected)).then((h) => { handle = h; });
  }
  wrap();
  return () => {
    window.removeEventListener("online", wrap);
    window.removeEventListener("offline", wrap);
    handle?.remove?.();
  };
}
