import * as Location from 'expo-location';
import type { ImagePickerAsset } from 'expo-image-picker';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { ApiError, type LocationPoint, type Party } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { uploadReportPhoto, type PhotoProgress } from '@/lib/report-photo';

// How often a checked-in member's location is sent while the app is open. The API counts up to
// 10 minutes between two on-site pings, and a member with none for 30 minutes leaves the walk-up.
const PING_INTERVAL_MS = 60_000;

export type EndOutcome = 'completed' | 'partial';

interface WalkUpContextValue {
  // The walk-up the signed-in user is checked in to, or null.
  party: Party | null;
  // Whether the last location ping was within 100 m of the spot; null before the first one.
  onSite: boolean | null;
  // Checks in at the user's current location, joining the quest's walk-up or starting one.
  checkIn: (questId: string) => Promise<Party>;
  leave: () => Promise<void>;
  // Ends the walk-up as its leader. Retrying with the same `progress` skips finished upload steps.
  end: (input: { photo: ImagePickerAsset; progress: PhotoProgress; bagCount: number; outcome: EndOutcome }) => Promise<Party>;
  // Reloads the user's walk-up, for when it may have changed elsewhere, such as a leader handoff.
  refresh: () => Promise<void>;
}

const WalkUpContext = createContext<WalkUpContextValue | null>(null);

// Check-in needs a precise fix, since the spot's geofence is only 100 m across.
async function currentLocation(): Promise<LocationPoint> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) throw new Error('Allow location access so CleanPursuit can check you in at the spot.');
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: coords.latitude, longitude: coords.longitude };
}

export function WalkUpProvider({ children }: { children: ReactNode }) {
  const { status, user, authedRequest } = useAuth();
  // Tagged with its user, so a walk-up never carries over to the next account that signs in.
  const [live, setLive] = useState<{ userId: string; party: Party; onSite: boolean | null } | null>(null);
  const current = status === 'signedIn' && live?.userId === user?.id ? live : null;
  const party = current?.party ?? null;
  const onSite = current?.onSite ?? null;
  const partyId = party?.id ?? null;
  const userId = user?.id ?? null;

  const track = useCallback(
    (next: Party | null, nextOnSite: boolean | null) =>
      setLive(next && userId ? { userId, party: next, onSite: nextOnSite } : null),
    [userId],
  );

  const refresh = useCallback(async () => {
    const { party: found } = await authedRequest<{ party: Party | null }>('/me/walk-up');
    setLive((previous) =>
      found && userId
        ? { userId, party: found, onSite: previous?.party.id === found.id ? previous.onSite : null }
        : null,
    );
  }, [authedRequest, userId]);

  // Find a walk-up left running before the app closed.
  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    let active = true;
    authedRequest<{ party: Party | null }>('/me/walk-up')
      .then(({ party: found }) => {
        if (active && found) setLive({ userId, party: found, onSite: null });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [status, userId, authedRequest]);

  // Ping while checked in and the app is open, and once more each time it comes back.
  // A ping that fails can be skipped: the next one a minute later counts the time in between.
  useEffect(() => {
    if (!partyId) return;
    const ping = async () => {
      try {
        const location = await currentLocation();
        const result = await authedRequest<{ onSite: boolean }>(`/parties/${partyId}/presence`, {
          method: 'POST',
          body: { location },
        });
        setLive((previous) => (previous?.party.id === partyId ? { ...previous, onSite: result.onSite } : previous));
      } catch (err) {
        // The walk-up ended, or the user timed out or was checked in elsewhere.
        if (err instanceof ApiError && err.status === 409) await refresh().catch(() => {});
      }
    };
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      ping();
      timer = setInterval(ping, PING_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      stop();
      subscription.remove();
    };
  }, [partyId, authedRequest, refresh]);

  const checkIn = useCallback(
    async (questId: string) => {
      const location = await currentLocation();
      const joined = await authedRequest<Party>(`/quests/${questId}/walk-up`, { method: 'POST', body: { location } });
      track(joined, true);
      return joined;
    },
    [authedRequest, track],
  );

  const leave = useCallback(async () => {
    if (!partyId) return;
    try {
      await authedRequest<Party>(`/parties/${partyId}/leave`, { method: 'POST' });
    } catch (err) {
      // Already out: the walk-up ended or the user timed out.
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
    track(null, null);
  }, [authedRequest, partyId, track]);

  const end = useCallback<WalkUpContextValue['end']>(
    async ({ photo, progress, bagCount, outcome }) => {
      if (!partyId) throw new Error("You're not checked in to a cleanup.");
      const afterPhotoFileId = await uploadReportPhoto(photo, authedRequest, progress);
      const ended = await authedRequest<Party>(`/parties/${partyId}/end`, {
        method: 'POST',
        body: { afterPhotoFileId, bagCount, outcome },
      });
      track(null, null);
      return ended;
    },
    [authedRequest, partyId, track],
  );

  return <WalkUpContext value={{ party, onSite, checkIn, leave, end, refresh }}>{children}</WalkUpContext>;
}

export function useWalkUp(): WalkUpContextValue {
  const value = use(WalkUpContext);
  if (!value) throw new Error('useWalkUp must be used inside WalkUpProvider');
  return value;
}
