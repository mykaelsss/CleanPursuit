# CleanPursuit app

The React Native (Expo) app for CleanPursuit.
See the repo root for the product and API docs.

## Run it

1. Install dependencies with `npm install`.
2. Start the API in `server/` with `infisical run -- npm run dev`.
3. Build and run a development build with `npm run android` or `npm run ios`, or open it in a browser with `npm run web`.

The app calls the API at `http://localhost:3000` (`http://10.0.2.2:3000` on the Android emulator).
On a physical device, copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` to your computer's LAN address.

### Rebuild after native dependency changes

After installing or updating a native package, rebuild the development app with `npm run ios` or `npm run android`.
Restarting Metro or reloading JavaScript does not add native modules to an already installed app.
For later JavaScript-only changes, use `npm start` with the rebuilt development app.

If startup reports `RNCWebViewModule` could not be found, the installed development app is missing the native part of `react-native-webview` used by the events map.
Run `npm run ios` from this directory for iOS, or `npm run android` for Android, then reopen the rebuilt app.
An Expo Router `ErrorBoundary` error following that failure is a consequence of the route import failing.

If the iOS rebuild skips installing the missing module, resync the generated project and install its pods explicitly before rebuilding:

```bash
npx expo prebuild --platform ios --no-clean
pod install --project-directory=ios
npm run ios
```

## Map

The events map is [Leaflet](https://leafletjs.com) with OpenStreetMap's standard tiles, so it needs no API key.
Those tiles are run by volunteers, so follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): fine for development and a demo, but switch to a paid tile provider before a real launch.
It runs in a WebView on phones and an iframe on web, from one page in `src/lib/leaflet-map-html.ts`.

## Leaderboard

The Leaderboard tab loads `GET /leaderboards?period=&limit=100` through the authenticated API client.
It starts on all time and offers Today, This week and This month, using UTC periods with Monday as the start of the week.
Rows show period XP, equal XP shares a rank, and accounts without positive period XP are left off the list.
The `me` response shows your rank even outside the top 100, or Unranked when your period XP is zero or negative.
Opening the tab or pulling to refresh fetches current results; failed refreshes keep the previous results and show a retry button.

## Layout

- `src/app/`: screens and layouts (Expo Router).
  `sign-in.tsx` is shown when signed out, and `(tabs)/` when signed in.
- `src/lib/`: the API client, auth context and token storage.
- `src/components/`, `src/constants/`, `src/hooks/`: shared UI, theme and hooks.

Run `npx tsc --noEmit` and `npm run lint` before committing.
