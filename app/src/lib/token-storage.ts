import * as SecureStore from 'expo-secure-store';

// The refresh token outlives the app process, so it lives in the iOS Keychain or Android Keystore.
const KEY = 'refreshToken';

export function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export function setRefreshToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(KEY, token);
}

export function clearRefreshToken(): Promise<void> {
  return SecureStore.deleteItemAsync(KEY);
}
