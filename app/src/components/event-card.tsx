import { Image } from 'expo-image';
import { useEffect, useState, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type Text,
  type ViewStyle,
} from 'react-native';

import { Avatar, displayStyles, squish, TierBadge, xpText } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme, useTierColors } from '@/hooks/use-theme';
import type { CleanupEvent, DifficultyTier, EventDetail } from '@/lib/api';
import { describeEventTime, formatDuration, formatEventTime, lookupAddress } from '@/lib/event-format';

// Platform guidelines ask for touch targets of at least 44pt (iOS) and 48dp (Android).
export const MIN_TOUCH = 48;

// Past this text size, label and value rows stack so neither gets squeezed.
const STACK_FONT_SCALE = 1.3;

interface EventCardProps {
  event: CleanupEvent;
  // Loaded after the card opens; holds the party member list.
  detail: EventDetail | null;
  busy: boolean;
  error: string | null;
  onJoin: () => void;
  onLeave: () => void;
  onClose: () => void;
  // The title, so the screen can move screen reader focus to it when the card opens.
  titleRef?: Ref<Text>;
}

export function EventCard({ event, detail, busy, error, onJoin, onLeave, onClose, titleRef }: EventCardProps) {
  const theme = useTheme();
  const leaderTag = useTierColors('legendary');
  // Keyed by event, so switching events never shows the previous event's address.
  const [resolved, setResolved] = useState<{ eventId: string; address: string } | null>(null);
  const address = resolved?.eventId === event.id ? resolved.address : null;
  const partySize = detail?.attendeeCount ?? event.attendeeCount;
  const duration = formatDuration(event.scheduledStart, event.scheduledEnd);

  useEffect(() => {
    let current = true;
    lookupAddress(event.location).then((a) => current && setResolved({ eventId: event.id, address: a }));
    return () => {
      current = false;
    };
  }, [event.id, event.location]);

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <ThemedText
          ref={titleRef}
          accessibilityRole="header"
          themeColor="text"
          style={[displayStyles.base, styles.title]}>
          {event.title}
        </ThemedText>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close quest details"
          style={squish([styles.closeButton, { backgroundColor: theme.backgroundElement, borderColor: theme.border }])}>
          <ThemedText type="smallBold" themeColor="text">
            Close
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.badges}>
        <TierBadge tier={event.difficultyTier} />
        {event.status === 'active' ? (
          <View style={[styles.liveBadge, { backgroundColor: theme.tint }]}>
            <ThemedText type="smallBold" themeColor="onTint">
              Happening now
            </ThemedText>
          </View>
        ) : null}
      </View>

      <SitePhoto
        photo={event.photo}
        tier={event.difficultyTier}
        style={styles.photo}
        label={`Photo of the cleanup site for ${event.title}`}
      />

      {/* The reward and the button that claims it, together on an ink panel. */}
      <View style={[styles.reward, { backgroundColor: theme.ink }]}>
        <View accessible accessibilityLabel={`Reward: ${xpText(event.maxXp)}. Stay the whole time slot to earn it all.`}>
          <ThemedText style={[displayStyles.base, styles.rewardXp, { color: theme.reward }]}>{xpText(event.maxXp)}</ThemedText>
          <ThemedText type="small" style={{ color: theme.onInkSoft }}>
            Stay the whole time slot to earn it all.
          </ThemedText>
        </View>

        {event.isOrganizer ? (
          <ThemedText style={[displayStyles.base, styles.rewardStatus, { color: theme.onInk }]}>
            {"You're leading this party"}
          </ThemedText>
        ) : event.joined ? (
          <View style={styles.joinedRow}>
            <ThemedText style={[displayStyles.base, styles.rewardStatus, styles.joinedLabel, { color: theme.onInk }]}>
              {"You're in the party"}
            </ThemedText>
            <Pressable
              onPress={onLeave}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Leave party"
              accessibilityState={{ disabled: busy, busy }}
              style={squish([styles.leaveButton, { borderColor: theme.onInkSoft }, busy && styles.busy])}>
              {busy ? (
                <ActivityIndicator color={theme.onInk} />
              ) : (
                <ThemedText type="smallBold" style={{ color: theme.onInk }}>
                  Leave party
                </ThemedText>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onJoin}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Join party"
            accessibilityState={{ disabled: busy, busy }}
            style={squish([styles.joinButton, { backgroundColor: theme.reward }, busy && styles.busy])}>
            {busy ? (
              <ActivityIndicator color={theme.onReward} />
            ) : (
              <ThemedText style={[displayStyles.base, styles.joinLabel, { color: theme.onReward }]}>Join party</ThemedText>
            )}
          </Pressable>
        )}
      </View>

      {error ? (
        <ThemedText type="small" themeColor="error">
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.facts}>
        <Fact label="Where" value={address ?? 'Finding address…'} />
        <Fact
          label="When"
          value={`${formatEventTime(event.scheduledStart, event.scheduledEnd)} (${duration})`}
          spokenValue={`${describeEventTime(event.scheduledStart, event.scheduledEnd)}, ${duration}`}
        />
        <Fact label="Leader" value={`@${event.organizer.username}`} />
      </View>

      <ThemedText style={styles.description}>{event.description}</ThemedText>

      <View style={styles.party}>
        <ThemedText accessibilityRole="header" themeColor="text" style={[displayStyles.base, styles.partyTitle]}>
          Party of {partySize}
        </ThemedText>
        {event.isOrganizer ? (
          <ThemedText type="small" themeColor="textSecondary">
            {"Only you, as leader, can see party members' emails."}
          </ThemedText>
        ) : null}
        {detail ? (
          detail.attendees.map((member) => (
            <View
              key={member.user.id}
              style={styles.member}
              accessible
              accessibilityLabel={[`@${member.user.username}`, member.isOrganizer ? 'leader' : null, member.email]
                .filter(Boolean)
                .join(', ')}>
              <Avatar username={member.user.username} />
              <View style={styles.memberText}>
                <View style={styles.memberName}>
                  <ThemedText>@{member.user.username}</ThemedText>
                  {member.isOrganizer ? (
                    <View style={[styles.leaderTag, { backgroundColor: leaderTag.soft }]}>
                      <ThemedText type="smallBold" style={{ color: leaderTag.onSoft }}>
                        Leader
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                {member.email ? (
                  <ThemedText type="small" themeColor="textSecondary" selectable>
                    {member.email}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ))
        ) : (
          <ActivityIndicator color={theme.textSecondary} style={styles.loading} accessibilityLabel="Loading party members" />
        )}
      </View>
    </View>
  );
}

// The site photo in a frame of its difficulty color, like loot of that rarity, tinted while it loads.
// Pass `label` to describe the photo to screen readers. Leave it out when the photo only decorates
// something that is already labeled, such as a list row, so it is skipped.
export function SitePhoto({
  photo,
  tier,
  style,
  label,
}: {
  photo: CleanupEvent['photo'];
  tier: DifficultyTier;
  style: StyleProp<ViewStyle>;
  label?: string;
}) {
  const colors = useTierColors(tier);
  const a11y = label
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: label } as const)
    : ({ accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);

  return (
    <View style={[styles.frame, style, { borderColor: colors.fill, backgroundColor: colors.soft }]} {...a11y}>
      <Image source={{ uri: photo.url, cacheKey: photo.id }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </View>
  );
}

// A label and its value, read together as one item by screen readers.
function Fact({ label, value, spokenValue }: { label: string; value: string; spokenValue?: string }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_FONT_SCALE;
  return (
    <View style={[styles.fact, stacked && styles.factStacked]} accessible accessibilityLabel={`${label}: ${spokenValue ?? value}`}>
      <ThemedText type="small" themeColor="textSecondary" style={!stacked && styles.factLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.factValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  title: {
    flex: 1,
    fontSize: 28,
    lineHeight: 34,
    paddingTop: Spacing.one,
  },
  closeButton: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  liveBadge: {
    justifyContent: 'center',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
  },
  frame: {
    borderWidth: 3,
    overflow: 'hidden',
  },
  photo: {
    height: 190,
    borderWidth: 4,
    borderRadius: 20,
  },
  reward: {
    padding: Spacing.three + Spacing.one,
    borderRadius: 20,
    gap: Spacing.three,
  },
  rewardXp: {
    fontSize: 30,
    lineHeight: 36,
  },
  rewardStatus: {
    fontSize: 20,
    lineHeight: 26,
  },
  joinedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  joinedLabel: {
    flexShrink: 1,
  },
  joinButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: 16,
  },
  joinLabel: {
    fontSize: 22,
    lineHeight: 28,
  },
  leaveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    minWidth: 112,
    paddingHorizontal: Spacing.three,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1.5,
  },
  busy: {
    opacity: 0.7,
  },
  facts: {
    gap: Spacing.two,
  },
  fact: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  factStacked: {
    flexDirection: 'column',
    gap: Spacing.half,
  },
  factLabel: {
    width: 64,
  },
  factValue: {
    flex: 1,
  },
  description: {
    lineHeight: 24,
  },
  party: {
    gap: Spacing.two + Spacing.one,
  },
  partyTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
  },
  memberText: {
    flex: 1,
    gap: Spacing.half,
  },
  memberName: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  leaderTag: {
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.one + Spacing.half,
  },
  loading: {
    alignSelf: 'flex-start',
  },
});
