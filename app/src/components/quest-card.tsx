import { router } from 'expo-router';
import { useEffect, useState, type Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ScheduleFields } from '@/components/create-quest/schedule-step';
import { createInitialSchedule, isValidSchedule, scheduleDates } from '@/components/create-quest/schedule-utils';
import { CardTitle, Fact, SitePhotoButton } from '@/components/event-card';
import { displayStyles, squish, TierBadge } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { MIN_TOUCH, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NearbyQuest, Quest } from '@/lib/api';
import { openDirections } from '@/lib/directions';
import { describeDistance, formatDistance, lookupAddress } from '@/lib/event-format';

interface QuestCardProps {
  quest: NearbyQuest;
  // Loaded after the card opens; holds the description and hazard warnings.
  detail: Quest | null;
  // Whether the quest is in a hotspot, where cleaning up earns bonus XP.
  hot: boolean;
  busy: boolean;
  error: string | null;
  onSchedule: (start: Date, end: Date) => void;
  onClose: () => void;
  // The title, so the screen can move screen reader focus to it when the card opens.
  titleRef?: Ref<Text>;
}

// An open quest with no party yet: the spot, its hazards, and a way to rally the first party.
export function QuestCard({ quest, detail, hot, busy, error, onSchedule, onClose, titleRef }: QuestCardProps) {
  const theme = useTheme();
  const [scheduling, setScheduling] = useState(false);
  const [schedule, setSchedule] = useState(createInitialSchedule);
  const validSchedule = isValidSchedule(schedule);
  // Older reports have no place name, so look up an address. Keyed by quest, so switching
  // quests never shows the previous quest's address.
  const [resolved, setResolved] = useState<{ questId: string; address: string | null } | null>(null);
  const lookup = resolved?.questId === quest.id ? resolved : null;
  const where = quest.placeName ?? (lookup ? (lookup.address ?? 'Pinned on the map') : 'Finding address…');
  const hazards = detail?.report.hazards ?? [];
  const needsDropoff = hazards.some((hazard) => hazard.requiresDropoff);

  useEffect(() => {
    if (quest.placeName) return;
    let current = true;
    lookupAddress(quest.location).then((a) => current && setResolved({ questId: quest.id, address: a }));
    return () => {
      current = false;
    };
  }, [quest.id, quest.location, quest.placeName]);

  function submit() {
    if (!validSchedule) return;
    const { start, end } = scheduleDates(schedule);
    onSchedule(start, end);
  }

  return (
    <View style={styles.container}>
      <CardTitle title={quest.title} onClose={onClose} titleRef={titleRef} />

      <View style={styles.badges}>
        <TierBadge tier={quest.difficultyTier} />
        {hot ? <HotspotBadge /> : null}
      </View>

      <SitePhotoButton photo={quest.photo} tier={quest.difficultyTier} title={quest.title} />

      {/* No reward to claim yet, so the panel asks for a leader instead. */}
      <View style={[styles.panel, { backgroundColor: theme.ink }]}>
        <View accessible>
          <ThemedText style={[displayStyles.base, styles.panelTitle, { color: theme.reward }]}>No party yet</ThemedText>
          <ThemedText type="small" style={{ color: theme.onInkSoft }}>
            {hot
              ? "Schedule one and you'll lead it. This spot is a hotspot, so finishing the cleanup earns bonus XP."
              : "Schedule one and you'll lead it. Everyone who checks in earns XP."}
          </ThemedText>
        </View>
        {scheduling ? null : (
          <Pressable
            onPress={() => setScheduling(true)}
            accessibilityRole="button"
            style={squish([styles.primaryButton, { backgroundColor: theme.reward }])}>
            <ThemedText style={[displayStyles.base, styles.primaryLabel, { color: theme.onReward }]}>
              Schedule a party
            </ThemedText>
          </Pressable>
        )}
      </View>

      {scheduling ? (
        <View style={styles.scheduler}>
          <ThemedText type="small" themeColor="textSecondary">
            Pick a future start and a later end on the same date, up to 12 hours apart.
          </ThemedText>
          <ScheduleFields value={schedule} onChange={setSchedule} />
          {validSchedule ? null : (
            <ThemedText type="small" themeColor="error">
              Choose a start in the future and an end later the same day, within 12 hours.
            </ThemedText>
          )}
          <View style={styles.actions}>
            <Pressable
              onPress={() => setScheduling(false)}
              disabled={busy}
              accessibilityRole="button"
              style={squish([styles.secondaryButton, { borderColor: theme.border }])}>
              <ThemedText type="smallBold" themeColor="text">
                Cancel
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={busy || !validSchedule}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !validSchedule, busy }}
              style={squish([
                styles.primaryButton,
                styles.grow,
                { backgroundColor: theme.ink },
                (busy || !validSchedule) && styles.dim,
              ])}>
              {busy ? (
                <ActivityIndicator color={theme.reward} />
              ) : (
                <ThemedText style={[displayStyles.base, styles.primaryLabel, { color: theme.reward }]}>
                  Schedule party
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <ThemedText type="small" themeColor="error">
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.facts}>
        <Fact label="Where" value={where} />
        <Fact label="Distance" value={formatDistance(quest.distanceM)} spokenValue={describeDistance(quest.distanceM)} />
      </View>

      <Pressable
        onPress={() =>
          openDirections({ name: quest.placeName ?? quest.title, ...quest.location })
        }
        accessibilityRole="button"
        accessibilityHint="Opens directions in a maps app"
        style={squish([styles.secondaryButton, { borderColor: theme.tint }])}>
        <ThemedText type="smallBold" themeColor="tint">
          Directions
        </ThemedText>
      </Pressable>

      {detail ? (
        <>
          <ThemedText style={styles.description}>{detail.report.description}</ThemedText>

          {hazards.length > 0 ? (
            <View style={styles.safety}>
              <ThemedText accessibilityRole="header" themeColor="text" style={[displayStyles.base, styles.safetyTitle]}>
                Safety
              </ThemedText>
              {hazards.map((hazard) => (
                <ThemedText key={hazard.code} type="small">
                  <ThemedText type="smallBold">{hazard.label}.</ThemedText> {hazard.warning}
                </ThemedText>
              ))}
              {needsDropoff ? (
                <Pressable
                  onPress={() => router.push(`/quests/${quest.id}/dropoffs`)}
                  accessibilityRole="button"
                  style={squish([styles.secondaryButton, { borderColor: theme.tint }])}>
                  <ThemedText type="smallBold" themeColor="tint">
                    Drop-off sites and who to call
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <ActivityIndicator color={theme.textSecondary} style={styles.loading} accessibilityLabel="Loading quest details" />
      )}
    </View>
  );
}

// Marks a quest or party in a hotspot, where cleaning up earns bonus XP.
export function HotspotBadge() {
  const theme = useTheme();
  return (
    <View
      style={[styles.hotspot, { backgroundColor: theme.emberSoft }]}
      accessible
      accessibilityLabel="Hotspot, bonus XP">
      <Flame color={theme.onEmberSoft} />
      <ThemedText style={[displayStyles.base, styles.hotspotText, { color: theme.onEmberSoft }]}>Hotspot</ThemedText>
    </View>
  );
}

function Flame({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        d="M12 2c.6 3.4 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.4 1-4 2.3-5.2.2 1.9 1 3 2.3 3.2C11 8 10.6 5 12 2Z"
        fill={color}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  hotspot: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
  },
  hotspotText: {
    fontSize: 15,
    lineHeight: 22,
  },
  panel: {
    padding: Spacing.three + Spacing.one,
    borderRadius: 20,
    gap: Spacing.three,
  },
  panelTitle: {
    fontSize: 28,
    lineHeight: 34,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: 16,
  },
  primaryLabel: {
    fontSize: 22,
    lineHeight: 28,
  },
  grow: {
    flex: 1,
  },
  dim: {
    opacity: 0.6,
  },
  scheduler: {
    gap: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1.5,
  },
  facts: {
    gap: Spacing.two,
  },
  description: {
    lineHeight: 24,
  },
  safety: {
    gap: Spacing.two + Spacing.one,
  },
  safetyTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  loading: {
    alignSelf: 'flex-start',
  },
});
