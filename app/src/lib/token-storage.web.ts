// SecureStore has no web implementation, so Expo web keeps the refresh token in localStorage.
const KEY = 'refreshToken';

export async function getRefreshToken(): Promise<string | null> {
  return localStorage.getItem(KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  localStorage.setItem(KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  localStorage.removeItem(KEY);
}
