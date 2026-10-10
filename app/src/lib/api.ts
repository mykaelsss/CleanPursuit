import { Platform } from 'react-native';

// The Android emulator reaches the host machine at 10.0.2.2. On a physical device, set
// EXPO_PUBLIC_API_URL to the computer's LAN address, such as http://192.168.1.20:3000.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export interface User {
  id: string;
  username: string;
  email: string;
  totalXp: number;
  createdAt: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export type Session = Tokens & { user: User };

// Mirrors the API's `errorSchema`. `code` is stable, so callers branch on it rather than on `message`.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function request<T>(
  path: string,
  { method = 'GET', body, accessToken }: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.code, data?.message ?? 'Something went wrong');
  }
  return data as T;
}

export const authApi = {
  register: (body: { username: string; email: string; password: string }) =>
    request<Session>('/auth/register', { method: 'POST', body }),
  login: (body: { identifier: string; password: string }) =>
    request<Session>('/auth/login', { method: 'POST', body }),
  refresh: (refreshToken: string) => request<Tokens>('/auth/refresh', { method: 'POST', body: { refreshToken } }),
  logout: (refreshToken: string) => request<void>('/auth/logout', { method: 'POST', body: { refreshToken } }),
  me: (accessToken: string) => request<User>('/me', { accessToken }),
};
