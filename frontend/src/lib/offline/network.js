import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

export const FIELD_ROLES = ["driver", "mechanic"];
export const isFieldRole = (role) => FIELD_ROLES.includes(role);

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
