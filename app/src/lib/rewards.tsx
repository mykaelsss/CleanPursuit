import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { RewardPopup } from '@/components/reward-popup';
import type { Reward } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// While a cleanup the user checked in to is still under way, how often to look for its reward.
// The leader can end it at any time, whether or not the user is still there.
const POLL_INTERVAL_MS = 60_000;

interface RewardsContextValue {
  // Looks for new rewards now, such as right after a cleanup ends. Never throws.
  check: () => Promise<void>;
}

const RewardsContext = createContext<RewardsContextValue | null>(null);

type Found = { userId: string; queue: Reward[]; pending: boolean };

// Shows each reward once, to everyone who checked in to the cleanup, as soon as the app hears about it:
// on sign-in, each time the app comes back, right after a cleanup ends, and every minute while one the
// user was at is still under way.
export function RewardsProvider({ children }: { children: ReactNode }) {
  const { status, user, authedRequest, reloadUser } = useAuth();
  const userId = status === 'signedIn' ? (user?.id ?? null) : null;
  // Tagged with its user, so rewards never show to the next account that signs in.
  const [found, setFound] = useState<Found | null>(null);
  const current = found?.userId === userId ? found : null;
  const reward = current?.queue[0] ?? null;
  const pending = current?.pending ?? false;
  // Collected this session, so a check that started before the API marked one seen does not show it again.
  const collected = useRef(new Set<string>());

  const load = useCallback(
    async (forUser: string) => {
      try {
        const result = await authedRequest<{ rewards: Reward[]; pending: boolean }>('/me/rewards');
        setFound((previous) => {
          const queue = previous?.userId === forUser ? previous.queue : [];
          const queued = new Set(queue.map((r) => r.partyId));
          const added = result.rewards.filter((r) => !queued.has(r.partyId) && !collected.current.has(r.partyId));
          return { userId: forUser, queue: [...queue, ...added], pending: result.pending };
        });
      } catch {
        // The next check picks it up.
      }
    },
    [authedRequest],
  );

  const check = useCallback(async () => {
    if (userId) await load(userId);
  }, [userId, load]);

  // Look on sign-in and each time the app comes back.
  useEffect(() => {
    if (!userId) return;
    load(userId);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load(userId);
    });
    return () => subscription.remove();
  }, [userId, load]);

  // Keep looking while a reward may be on its way and the app is open.
  useEffect(() => {
    if (!userId || !pending) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => load(userId), POLL_INTERVAL_MS);
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
  }, [userId, pending, load]);

  const collect = useCallback(
    (collecting: Reward) => {
      collected.current.add(collecting.partyId);
      setFound((previous) =>
        previous ? { ...previous, queue: previous.queue.filter((r) => r.partyId !== collecting.partyId) } : previous,
      );
      // If this fails, the reward shows again next time the app starts, which beats never showing it.
      authedRequest(`/me/rewards/${collecting.partyId}/seen`, { method: 'POST' }).catch(() => {});
      // The profile shows the new total and level.
      reloadUser().catch(() => {});
    },
    [authedRequest, reloadUser],
  );

  const value = useMemo(() => ({ check }), [check]);

  return (
    <RewardsContext value={value}>
      {children}
      <RewardPopup reward={reward} isLeader={reward?.leader.id === userId} onCollect={collect} />
    </RewardsContext>
  );
}

export function useRewards(): RewardsContextValue {
  const value = use(RewardsContext);
  if (!value) throw new Error('useRewards must be used inside RewardsProvider');
  return value;
}
