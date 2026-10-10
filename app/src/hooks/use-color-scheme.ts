// The app is light mode only for now. To follow the device setting instead, re-export
// `useColorScheme` from 'react-native' here and set "userInterfaceStyle" to "automatic" in app.json.
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
