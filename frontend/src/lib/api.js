import axios from "axios";
import { isOnline } from "./offline/network";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "dt_token";
const REFRESH_KEY = "dt_refresh";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);
export const setRefreshToken = (t) => (t ? localStorage.setItem(REFRESH_KEY, t) : localStorage.removeItem(REFRESH_KEY));
const USER_KEY = "dt_user";
export const getCachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};
export const setCachedUser = (u) => (u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY));

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let refreshing = null;

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config || {};
    const url = orig.url || "";
    const isAuth = url.includes("/auth/login") || url.includes("/auth/refresh");
    if (err.response?.status === 401 && !orig._retry && !isAuth) {
      orig._retry = true;
      const rt = getRefreshToken();
      if (rt) {
        try {
          refreshing = refreshing || axios.post(`${API}/auth/refresh`, { refresh_token: rt });
          const { data } = await refreshing;
          refreshing = null;
          setToken(data.access_token);
          if (data.refresh_token) setRefreshToken(data.refresh_token);
          orig.headers = orig.headers || {};
          orig.headers.Authorization = `Bearer ${data.access_token}`;
          return api(orig);
        } catch (e) {
          refreshing = null;
        }
      }
      if (await isOnline()) {
        setToken(null);
        setRefreshToken(null);
        if (!window.location.pathname.startsWith("/login")) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.href = `/login?next=${encodeURIComponent(next)}`;
        }
      }
    }
    return Promise.reject(err);
  }
);

export async function fetchFileObjectUrl(path) {
  const res = await api.get(`/files/${path}`, { responseType: "blob" });
  return URL.createObjectURL(res.data);
}

export function errMsg(e, fallback = "Something went wrong") {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  return d?.msg || String(d);
}

export async function downloadCsv(url, params, filename) {
  const res = await api.get(url, { params, responseType: "blob" });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}
