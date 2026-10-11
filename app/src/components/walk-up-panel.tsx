import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import {
  CheckedInPanel,
  EndedPanel,
  GEOFENCE_METERS,
  OtherCleanupNote,
  panelStyles as styles,
  PrimaryButton,
  useAction,
  usePanelColors,
  type PanelTone,
  type PartyChange,
} from '@/components/party-panel';
import { displayStyles, LiveBadge, onSiteText } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { Party, WalkUp } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLiveParty } from '@/lib/live-party';

// Keep in sync with WALK_UP_SLOT_MINUTES in the API (docs/mvp.md).
const FULL_XP_MINUTES = 60;

interface WalkUpPanelProps {
  questId: string;
  // The quest's walk-up under way, as the API last reported it.
  walkUp: WalkUp | null;
  maxXp: number;
  hot: boolean;
  tone: PanelTone;
  // What the panel says when nobody is on site.
  idle: { title: string; text: string; action: string };
  // More actions for when nobody is on site, such as scheduling a party.
  children?: ReactNode;
  onChange: (change: PartyChange) => void;
}

// A quest's walk-up cleanup: check in at the spot to start or join one, then leave, or end it with an
// after photo as its leader.
export function WalkUpPanel({ questId, walkUp, maxXp, hot, tone, idle, children, onChange }: WalkUpPanelProps) {
  const theme = useTheme();
  const colors = usePanelColors(tone);
  const { user } = useAuth();
  const session = useLiveParty();
  const { busy, error, run } = useAction();
  const [ended, setEnded] = useState<Party | null>(null);

  const mine = session.party?.questId === questId && session.party.scheduledStart === null ? session.party : null;
  const reward = `Up to ${maxXp.toLocaleString()} XP for ${FULL_XP_MINUTES} minutes on site.`;

  const checkIn = () =>
    run(async () => {
      const party = await session.checkInWalkUp(questId);
      const leading = party.leader.id === user?.id;
      AccessibilityInfo.announceForAccessibility(
        leading ? "You're checked in and leading the cleanup" : "You're checked in",
      );
      onChange('checkedIn');
    });

  if (ended) return <EndedPanel status={ended.status} tone={tone} />;

  if (mine) {
    // The card reloads the quest's walk-up when it opens, which is fresher than the check-in response
    // after others join or the lead is handed off.
    const fresh = walkUp?.partyId === mine.id ? walkUp : null;
    return (
      <CheckedInPanel
        party={mine}
        leader={fresh?.leader ?? mine.leader}
        onSiteCount={fresh?.checkedInCount ?? mine.members.filter((m) => m.status === 'checked_in').length}
        tone={tone}
        hot={hot}
        onLeft={() => onChange('left')}
        onEnded={(party) => {
          setEnded(party);
          onChange('ended');
        }}
      />
    );
  }

  return (
    <View style={[styles.panel, colors.panel]}>
      <View style={styles.text} accessible>
        {walkUp ? (
          <>
            <View style={styles.titleRow}>
              <ThemedText style={[displayStyles.base, styles.title, styles.grow, { color: colors.title }]}>
                Cleanup under way
              </ThemedText>
              <LiveBadge count={walkUp.checkedInCount} />
            </View>
            <ThemedText type="small" style={{ color: colors.strong }}>
              @{walkUp.leader.username} is leading, with {onSiteText(walkUp.checkedInCount)}. Check in when you get there
              to join.
            </ThemedText>
          </>
        ) : (
          <>
            <ThemedText style={[displayStyles.base, styles.title, { color: colors.title }]}>{idle.title}</ThemedText>
            <ThemedText type="small" style={{ color: colors.strong }}>
              {idle.text}
            </ThemedText>
          </>
        )}
        <ThemedText type="small" style={{ color: colors.text }}>
          {hot ? `${reward} This spot is a hotspot, so finishing the cleanup earns bonus XP.` : reward}
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <OtherCleanupNote other={session.party} color={colors.strong} />
        <PrimaryButton
          label={walkUp ? 'Check in and join' : idle.action}
          hint={`You need to be within ${GEOFENCE_METERS} m of the spot`}
          color={colors.primary}
          onColor={colors.onPrimary}
          onPress={checkIn}
          busy={busy}
        />
        <ThemedText
          type="small"
          style={{ color: colors.text }}
          importantForAccessibility="no"
          accessibilityElementsHidden>
          {`Check in once you're within ${GEOFENCE_METERS} m of the spot.`}
        </ThemedText>
        {children}
      </View>

      {error ? (
        <ThemedText type="small" style={{ color: theme.error }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}
