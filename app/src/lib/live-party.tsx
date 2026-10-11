import * as Location from 'expo-location';
import type { ImagePickerAsset } from 'expo-image-picker';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { ApiError, type LocationPoint, type Party } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { uploadReportPhoto, type PhotoProgress } from '@/lib/report-photo';
import { useRewards } from '@/lib/rewards';

// How often a checked-in member's location is sent while the app is open. The API counts up to
// 10 minutes between two on-site pings, and a member with none for 30 minutes leaves the cleanup.
const PING_INTERVAL_MS = 60_000;

export type EndOutcome = 'completed' | 'partial';

interface LivePartyContextValue {
  // The cleanup the signed-in user is checked in to, walk-up or event, or null. The API allows one at a time.
  party: Party | null;
  // Whether the last location ping was within 100 m of the spot; null before the first one.
  onSite: boolean | null;
  // Checks in at the user's current location, joining the quest's walk-up or starting one.
  checkInWalkUp: (questId: string) => Promise<Party>;
  // Checks in to an event the user signed up for, at the user's current location.
  checkInEvent: (partyId: string) => Promise<Party>;
  leave: () => Promise<void>;
  // Ends the cleanup as its leader. Retrying with the same `progress` skips finished upload steps.
  end: (input: { photo: ImagePickerAsset; progress: PhotoProgress; bagCount: number; outcome: EndOutcome }) => Promise<Party>;
  // Reloads the user's cleanup, for when it may have changed elsewhere, such as a leader handoff.
  refresh: () => Promise<void>;
}

const LivePartyContext = createContext<LivePartyContextValue | null>(null);

// Check-in needs a precise fix, since the spot's geofence is only 100 m across.
async function currentLocation(): Promise<LocationPoint> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) throw new Error('Allow location access so CleanPursuit can check you in at the spot.');
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: coords.latitude, longitude: coords.longitude };
}

export function LivePartyProvider({ children }: { children: ReactNode }) {
  const { status, user, authedRequest } = useAuth();
  const rewards = useRewards();
  // Tagged with its user, so a cleanup never carries over to the next account that signs in.
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
    const { party: found } = await authedRequest<{ party: Party | null }>('/me/party');
    setLive((previous) =>
      found && userId
        ? { userId, party: found, onSite: previous?.party.id === found.id ? previous.onSite : null }
        : null,
    );
    // The cleanup may have ended with XP for the user.
    if (!found) await rewards.check();
  }, [authedRequest, userId, rewards]);

  // Find a cleanup left running before the app closed.
  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    let active = true;
    authedRequest<{ party: Party | null }>('/me/party')
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
        // The cleanup ended, or the user timed out or was checked in elsewhere.
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

  const checkInWalkUp = useCallback(
    async (questId: string) => {
      const location = await currentLocation();
      const joined = await authedRequest<Party>(`/quests/${questId}/walk-up`, { method: 'POST', body: { location } });
      track(joined, true);
      return joined;
    },
    [authedRequest, track],
  );

  const checkInEvent = useCallback(
    async (eventId: string) => {
      const location = await currentLocation();
      const joined = await authedRequest<Party>(`/parties/${eventId}/check-in`, { method: 'POST', body: { location } });
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
      // Already out: the cleanup ended or the user timed out.
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
    track(null, null);
    // The user keeps the time they spent and earns XP when the cleanup ends, so watch for it.
    await rewards.check();
  }, [authedRequest, partyId, track, rewards]);

  const end = useCallback<LivePartyContextValue['end']>(
    async ({ photo, progress, bagCount, outcome }) => {
      if (!partyId) throw new Error("You're not checked in to a cleanup.");
      const afterPhotoFileId = await uploadReportPhoto(photo, authedRequest, progress);
      const ended = await authedRequest<Party>(`/parties/${partyId}/end`, {
        method: 'POST',
        body: { afterPhotoFileId, bagCount, outcome },
      });
      track(null, null);
      await rewards.check();
      return ended;
    },
    [authedRequest, partyId, track, rewards],
  );

  return (
    <LivePartyContext value={{ party, onSite, checkInWalkUp, checkInEvent, leave, end, refresh }}>
      {children}
    </LivePartyContext>
  );
}

export function useLiveParty(): LivePartyContextValue {
  const value = use(LivePartyContext);
  if (!value) throw new Error('useLiveParty must be used inside LivePartyProvider');
  return value;
}
