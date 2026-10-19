import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getCachedUser, getToken, setCachedUser, setRefreshToken, setToken } from "../lib/api";
import { isOnline } from "../lib/offline/network";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!getToken() && !getCachedUser()) {
      setUser(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => {
        setCachedUser(r.data);
        setUser(r.data);
      })
      .catch(async () => {
        if (!(await isOnline())) {
          const cached = getCachedUser();
          setUser(cached || false);
          return;
        }
        setToken(null);
        setRefreshToken(null);
        setCachedUser(null);
        setUser(false);
      });
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setToken(data.access_token);
    setRefreshToken(data.refresh_token || null);
    const me = await api.get("/auth/me");
    setCachedUser(me.data);
    setUser(me.data);
    return me.data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setRefreshToken(null);
    setCachedUser(null);
    setUser(false);
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
