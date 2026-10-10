import type { ConfigContext, ExpoConfig } from 'expo/config';

// Extends app.json with settings that come from the environment, so keys stay out of the repo.
// GOOGLE_MAPS_API_KEY comes from Infisical or app/.env.local, and is read when the native app is built.
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleMapsApiKey) {
    console.warn('GOOGLE_MAPS_API_KEY is not set, so the events map will be blank in native builds.');
  }

  return {
    ...config,
    name: config.name ?? 'CleanPursuit',
    slug: config.slug ?? 'CleanPursuit',
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey: googleMapsApiKey, iosGoogleMapsApiKey: googleMapsApiKey }],
    ],
  };
};
