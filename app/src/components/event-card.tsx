import { Image } from 'expo-image';
import { useEffect, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type Text,
  type ViewStyle,
} from 'react-native';

import {
  CheckedInPanel,
  EndedPanel,
  GEOFENCE_METERS,
  isOver,
  OtherCleanupNote,
  PrimaryButton,
  timeOfDay,
  useAction,
  type PartyChange,
} from '@/components/party-panel';
import { PhotoViewer } from '@/components/photo-viewer';
import { Avatar, displayStyles, LiveBadge, squish, TierBadge, xpText } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { WalkUpPanel } from '@/components/walk-up-panel';
import { MIN_TOUCH, Spacing } from '@/constants/theme';
import { useNow } from '@/hooks/use-now';
import { useTheme, useTierColors } from '@/hooks/use-theme';
import type { CleanupEvent, DifficultyTier, EventDetail, Party } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeEventTime, formatDuration, formatEventTime, lookupAddress } from '@/lib/event-format';
import { useLiveParty } from '@/lib/live-party';

// Past this text size, label and value rows stack so neither gets squeezed.
const STACK_FONT_SCALE = 1.3;
// How often the card checks whether the party has started or its time slot is over.
const CLOCK_INTERVAL_MS = 15_000;

interface EventCardProps {
  event: CleanupEvent;
  // Loaded after the card opens; holds the party member list.
  detail: EventDetail | null;
  // Whether the spot is in a hotspot, where cleaning up earns bonus XP.
  hot: boolean;
  busy: boolean;
  error: string | null;
  onJoin: () => void;
  onLeave: () => void;
  onPartyChange: (change: PartyChange) => void;
  onClose: () => void;
  // The title, so the screen can move screen reader focus to it when the card opens.
  titleRef?: Ref<Text>;
}

export function EventCard({
  event,
  detail,
  hot,
  busy,
  error,
  onJoin,
  onLeave,
  onPartyChange,
  onClose,
  titleRef,
}: EventCardProps) {
  const theme = useTheme();
  const leaderTag = useTierColors('legendary');
  // Older reports have no place name, so look up an address. Keyed by event, so switching
  // events never shows the previous event's address.
  const [resolved, setResolved] = useState<{ eventId: string; address: string | null } | null>(null);
  const lookup = resolved?.eventId === event.id ? resolved : null;
  const where = event.placeName ?? (lookup ? (lookup.address ?? 'Pinned on the map') : 'Finding address…');
  const partySize = detail?.attendeeCount ?? event.attendeeCount;
  const duration = formatDuration(event.scheduledStart, event.scheduledEnd);
  // The detail is fresher than the list once it has loaded.
  const walkUp = detail ? detail.walkUp : event.walkUp;
  const myStatus = detail ? detail.myStatus : event.myStatus;

  const { user } = useAuth();
  const session = useLiveParty();
  const checkIn = useAction();
  // Kept with its event, since the screen reuses this card when another event is picked.
  const [ended, setEnded] = useState<{ eventId: string; party: Party } | null>(null);
  // Ended here, or by the leader while the card was open.
  const endedStatus = ended?.eventId === event.id ? ended.party.status : detail && isOver(detail.status) ? detail.status : null;
  const now = useNow(CLOCK_INTERVAL_MS);
  const started = Date.parse(event.scheduledStart) <= now;
  const over = Date.parse(event.scheduledEnd) <= now;
  const mine = session.party?.id === event.id ? session.party : null;
  // Members who left can come back until the end; anyone else joins first.
  const member = myStatus === 'signed_up' || myStatus === 'checked_in' || myStatus === 'left';
  // The walk-up below is for getting going before the party. Once it starts, everyone checks in to the
  // party instead, but a user already in the quest's walk-up still sees it, to leave or end it.
  const inWalkUp = session.party?.questId === event.questId && session.party.scheduledStart === null;
  const showWalkUp = (!started && !endedStatus) || inWalkUp;

  const leader = detail?.organizer ?? event.organizer;
  const onSiteCount = detail
    ? detail.attendees.filter((a) => a.status === 'checked_in').length
    : (mine?.members.filter((m) => m.status === 'checked_in').length ?? 0);

  const checkInToEvent = () =>
    checkIn.run(async () => {
      const party = await session.checkInEvent(event.id);
      AccessibilityInfo.announceForAccessibility(
        party.leader.id === user?.id ? "You're checked in and leading the party" : "You're checked in",
      );
      onPartyChange('checkedIn');
    });

  useEffect(() => {
    if (event.placeName) return;
    let current = true;
    lookupAddress(event.location).then((a) => current && setResolved({ eventId: event.id, address: a }));
    return () => {
      current = false;
    };
  }, [event.id, event.location, event.placeName]);

  return (
    <View style={styles.container}>
      <CardTitle title={event.title} onClose={onClose} titleRef={titleRef} />

      <View style={styles.badges}>
        <TierBadge tier={event.difficultyTier} />
        {event.status === 'active' ? (
          <View style={[styles.liveBadge, { backgroundColor: theme.tint }]}>
            <ThemedText type="smallBold" themeColor="onTint">
              Happening now
            </ThemedText>
          </View>
        ) : null}
        {walkUp ? <LiveBadge count={walkUp.checkedInCount} /> : null}
      </View>

      <SitePhotoButton photo={event.photo} tier={event.difficultyTier} title={event.title} />

      {/* The reward and the button that claims it, together on an ink panel. */}
      {endedStatus ? (
        <EndedPanel status={endedStatus} tone="ink" />
      ) : mine ? (
        <CheckedInPanel
          party={mine}
          leader={leader}
          onSiteCount={onSiteCount}
          tone="ink"
          hot={hot}
          note={
            over
              ? leader.id === user?.id
                ? "The party's time is up, so time from now on doesn't count. End the cleanup to award everyone's XP."
                : `The party's time is up. Everyone's XP comes through when @${leader.username} ends the cleanup.`
              : null
          }
          onLeft={() => onPartyChange('left')}
          onEnded={(party) => {
            setEnded({ eventId: event.id, party });
            onPartyChange('ended');
          }}
        />
      ) : (
        <View style={[styles.reward, { backgroundColor: theme.ink }]}>
          <View accessible accessibilityLabel={`Reward: ${xpText(event.maxXp)}. Stay the whole time slot to earn it all.`}>
            <ThemedText style={[displayStyles.base, styles.rewardXp, { color: theme.reward }]}>{xpText(event.maxXp)}</ThemedText>
            <ThemedText type="small" style={{ color: theme.onInkSoft }}>
              Stay the whole time slot to earn it all.
            </ThemedText>
          </View>

          {over ? (
            <ThemedText type="small" style={{ color: theme.onInk }}>
              {event.status === 'active'
                ? `Check-in closed at ${timeOfDay(event.scheduledEnd)}. Everyone's XP comes through when @${leader.username} ends the cleanup.`
                : `Check-in closed at ${timeOfDay(event.scheduledEnd)}.`}
            </ThemedText>
          ) : started && member ? (
            <View style={styles.checkIn}>
              <View accessible>
                <ThemedText style={[displayStyles.base, styles.rewardStatus, { color: theme.onInk }]}>
                  {myStatus === 'left' ? 'Back at the spot?' : "The party's on"}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.onInkSoft }}>
                  {myStatus === 'left'
                    ? 'Check in again to keep earning XP. Your earlier time still counts.'
                    : `Check in once you're within ${GEOFENCE_METERS} m of the spot to start earning XP.`}
                </ThemedText>
              </View>
              <OtherCleanupNote other={session.party} color={theme.onInk} />
              <PrimaryButton
                label={myStatus === 'left' ? 'Check in again' : 'Check in'}
                hint={`You need to be within ${GEOFENCE_METERS} m of the spot`}
                color={theme.reward}
                onColor={theme.onReward}
                onPress={checkInToEvent}
                busy={checkIn.busy}
              />
              {checkIn.error ? (
                <ThemedText type="small" style={{ color: theme.onInk }}>
                  {checkIn.error}
                </ThemedText>
              ) : null}
            </View>
          ) : event.isOrganizer ? (
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
            <View style={styles.checkIn}>
              {started ? (
                <ThemedText type="small" style={{ color: theme.onInk }}>
                  {"The party's on. Join, then check in at the spot."}
                </ThemedText>
              ) : null}
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
            </View>
          )}
        </View>
      )}

      {error ? (
        <ThemedText type="small" themeColor="error">
          {error}
        </ThemedText>
      ) : null}

      {/* Anyone at the spot can start cleaning before the party, or join a walk-up already going. */}
      {showWalkUp ? (
        <WalkUpPanel
          questId={event.questId}
          walkUp={walkUp}
          maxXp={event.maxXp}
          hot={hot}
          tone="plain"
          idle={{
            title: 'Here early?',
            text: "You don't have to wait for the party. Check in to start cleaning now, and anyone at the spot can join.",
            action: 'Check in now',
          }}
          onChange={onPartyChange}
        />
      ) : null}

      <View style={styles.facts}>
        <Fact label="Where" value={where} />
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

// The card's title with its Close button.
export function CardTitle({ title, onClose, titleRef }: { title: string; onClose: () => void; titleRef?: Ref<Text> }) {
  const theme = useTheme();
  return (
    <View style={styles.titleRow}>
      <ThemedText ref={titleRef} accessibilityRole="header" themeColor="text" style={[displayStyles.base, styles.title]}>
        {title}
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
  );
}

// The large site photo on a card, which opens full screen when tapped.
export function SitePhotoButton({
  photo,
  tier,
  title,
}: {
  photo: CleanupEvent['photo'];
  tier: DifficultyTier;
  title: string;
}) {
  const theme = useTheme();
  const [viewing, setViewing] = useState(false);
  const label = `Photo of the cleanup site for ${title}`;
  return (
    <>
      <Pressable
        onPress={() => setViewing(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
        accessibilityHint="Opens the photo full screen"
        style={squish(styles.photoButton)}>
        <SitePhoto photo={photo} tier={tier} style={styles.photo} />
        <View style={[styles.enlarge, { backgroundColor: theme.ink }]}>
          <ThemedText type="smallBold" style={{ color: theme.onInk }}>
            Tap to enlarge
          </ThemedText>
        </View>
      </Pressable>
      <PhotoViewer photo={photo} visible={viewing} onClose={() => setViewing(false)} label={label} />
    </>
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
export function Fact({ label, value, spokenValue }: { label: string; value: string; spokenValue?: string }) {
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
  photoButton: {
    position: 'relative',
  },
  photo: {
    height: 190,
    borderWidth: 4,
    borderRadius: 20,
  },
  enlarge: {
    position: 'absolute',
    right: Spacing.two + Spacing.one,
    bottom: Spacing.two + Spacing.one,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
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
  checkIn: {
    gap: Spacing.two + Spacing.one,
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
