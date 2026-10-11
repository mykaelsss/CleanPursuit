import { useColorScheme as useRNColorScheme } from 'react-native';

// Follows the device setting. 'unspecified' (no preference reported) falls back to light.
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
