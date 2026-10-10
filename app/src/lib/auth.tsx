import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ApiError, authApi, request, type Session, type Tokens, type User } from '@/lib/api';
import { clearRefreshToken, getRefreshToken, setRefreshToken } from '@/lib/token-storage';

type Status = 'loading' | 'signedIn' | 'signedOut';

interface AuthContextValue {
  status: Status;
  user: User | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Calls a protected route, refreshing the access token once if it has expired.
  authedRequest: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  // Tokens live in refs: they change on every refresh and nothing renders them.
  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);
  // Refresh tokens are single use, and the API signs the user out everywhere if one is reused,
  // so concurrent requests must share one refresh instead of each starting their own.
  const pendingRefresh = useRef<Promise<string> | null>(null);

  const storeTokens = useCallback(async (tokens: Tokens) => {
    accessToken.current = tokens.accessToken;
    refreshToken.current = tokens.refreshToken;
    await setRefreshToken(tokens.refreshToken);
  }, []);

  const forget = useCallback(async () => {
    accessToken.current = null;
    refreshToken.current = null;
    setUser(null);
    setStatus('signedOut');
    await clearRefreshToken();
  }, []);

  const refresh = useCallback((): Promise<string> => {
    pendingRefresh.current ??= (async () => {
      try {
        const stored = refreshToken.current;
        if (!stored) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Sign in again');
        const tokens = await authApi.refresh(stored);
        await storeTokens(tokens);
        return tokens.accessToken;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) await forget();
        throw err;
      } finally {
        pendingRefresh.current = null;
      }
    })();
    return pendingRefresh.current;
  }, [forget, storeTokens]);

  // Restore the session from the stored refresh token on launch.
  useEffect(() => {
    (async () => {
      try {
        refreshToken.current = await getRefreshToken();
        if (!refreshToken.current) {
          setStatus('signedOut');
          return;
        }
        const token = await refresh();
        setUser(await authApi.me(token));
        setStatus('signedIn');
      } catch {
        // A 401 already cleared the token. Other failures, such as no network, keep it so the
        // next launch can try again, but show the sign-in screen for now.
        setStatus('signedOut');
      }
    })();
  }, [refresh]);

  const start = useCallback(
    async (session: Session) => {
      await storeTokens(session);
      setUser(session.user);
      setStatus('signedIn');
    },
    [storeTokens],
  );

  const signIn = useCallback(
    async (identifier: string, password: string) => start(await authApi.login({ identifier, password })),
    [start],
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string) =>
      start(await authApi.register({ username, email, password })),
    [start],
  );

  const signOut = useCallback(async () => {
    const token = refreshToken.current;
    await forget();
    // Best effort: the user is signed out locally even if the API is unreachable.
    if (token) await authApi.logout(token).catch(() => {});
  }, [forget]);

  const authedRequest = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
      const token = accessToken.current ?? (await refresh());
      try {
        return await request<T>(path, { ...options, accessToken: token });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        return request<T>(path, { ...options, accessToken: await refresh() });
      }
    },
    [refresh],
  );

  return (
    <AuthContext value={{ status, user, signIn, signUp, signOut, authedRequest }}>{children}</AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
