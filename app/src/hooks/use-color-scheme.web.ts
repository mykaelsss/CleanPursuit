import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Nothing to subscribe to: the value only changes once, from server to client.
const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * The static HTML is rendered in light mode, so hydration uses 'light' and React then
 * re-renders with the real color scheme.
 */
export function useColorScheme(): 'light' | 'dark' {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();

  return hydrated && colorScheme === 'dark' ? 'dark' : 'light';
}
