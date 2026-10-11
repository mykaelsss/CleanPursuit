# CleanPursuit app

The React Native (Expo) app for CleanPursuit.
See the repo root for the product and API docs.

## Run it

1. Install dependencies with `npm install`.
2. Start the API in `server/` with `infisical run -- npm run dev`.
3. Build and run a development build with `npm run android` or `npm run ios`, or open it in a browser with `npm run web`.

The app calls the API at `http://localhost:3000` (`http://10.0.2.2:3000` on the Android emulator).
On a physical device, copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` to your computer's LAN address.

## Google Maps

The events map needs `GOOGLE_MAPS_API_KEY`, with the Maps SDK for Android (and iOS) enabled in Google Cloud.
Put it in Infisical or `.env.local` (see `.env.example`).
It is baked into the native app, so after setting or changing it, regenerate the native project and rebuild:

```bash
npx expo prebuild --clean
npm run android
```

## Layout

- `src/app/`: screens and layouts (Expo Router).
  `sign-in.tsx` is shown when signed out, and `(tabs)/` when signed in.
- `src/lib/`: the API client, auth context and token storage.
- `src/components/`, `src/constants/`, `src/hooks/`: shared UI, theme and hooks.

Run `npx tsc --noEmit` and `npm run lint` before committing.
