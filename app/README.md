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

If startup reports `RNCWebViewModule` could not be found, the installed development app is missing the native part of `react-native-webview` used by the Quests map.
Run `npm run ios` from this directory for iOS, or `npm run android` for Android, then reopen the rebuilt app.
An Expo Router `ErrorBoundary` error following that failure is a consequence of the route import failing.

If the iOS rebuild skips installing the missing module, resync the generated project and install its pods explicitly before rebuilding:

```bash
npx expo prebuild --platform ios --no-clean
pod install --project-directory=ios
npm run ios
```

## Map

The Quests map is [Leaflet](https://leafletjs.com) with OpenStreetMap's standard tiles, so it needs no API key.
Those tiles are run by volunteers, so follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): fine for development and a demo, but switch to a paid tile provider before a real launch.
It runs in a WebView on phones and an iframe on web, from one page in `src/lib/leaflet-map-html.ts`.

It shows scheduled parties as XP bubbles, open quests with no party as "!" waypoints, and hotspots from `GET /hotspots` as ember glows that turn into H3 hexagons at street zoom.
See [Quests map](../docs/mvp.md#quests-map) for the rules.

## Leaderboard

The Leaderboard tab loads `GET /leaderboards?period=&limit=100` through the authenticated API client.
It starts on all time and offers Today, This week and This month, using UTC periods with Monday as the start of the week.
Rows show period XP, equal XP shares a rank, and accounts without positive period XP are left off the list.
The `me` response shows your rank even outside the top 100, or Unranked when your period XP is zero or negative.
Opening the tab or pulling to refresh fetches current results; failed refreshes keep the previous results and show a retry button.

## Create a quest

The tab uploads a resized JPEG before photo directly to R2 and asks the API for saved Gemini suggestions.
Report descriptions, categories, all five hazard flags and optional gallon ranges are editable; late AI responses preserve manual edits.
AI can be skipped or unavailable without blocking reporting.
Confirm the report details and cleanup coordinates before submitting.
Use GPS, an address lookup on phones, or manually entered coordinates, and give the spot a readable place name.
The form shows bag equivalents and validates the API's volume-range rules.

Scheduling a party is optional.
If enabled, choose a future start and a later end on the same date, at most 12 hours apart, in the device's time zone.
Scheduling makes you the organizer and first attendee.
The API saves the report, quest and optional event in order; failures retain completed records for retries while the tab remains mounted.
Duplicate reports use the original quest and ask you to review it before scheduling a party there.
Additional hazards from the new sighting remain visible and hide the original gear recommendations.
The result shows difficulty, bag estimates, equipment, hazard warnings and drop-off or escalation guidance.
Party size is not collected because the API does not store a target or limit sign-ups.

Photo preparation uses `expo-image-manipulator` and native uploads use `expo-file-system` with `expo/fetch`.
Both are available in Expo Go; an existing development build needs rebuilding after installing these dependencies.

Run client workflow regression tests with `npm test`.

## Layout

- `src/app/`: screens and layouts (Expo Router).
  `sign-in.tsx` is shown when signed out, and `(tabs)/` when signed in.
- `src/lib/`: the API client, auth context and token storage.
- `src/components/`, `src/constants/`, `src/hooks/`: shared UI, theme and hooks.

Run `npx tsc --noEmit` and `npm run lint` before committing.
