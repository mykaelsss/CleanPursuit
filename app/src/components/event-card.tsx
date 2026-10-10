import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CleanupEvent, EventDetail } from '@/lib/api';
import { formatDuration, formatEventTime, lookupAddress, TIER_LABELS } from '@/lib/event-format';

interface EventCardProps {
  event: CleanupEvent;
  // Loaded after the card opens; holds the attendee list.
  detail: EventDetail | null;
  busy: boolean;
  error: string | null;
  onJoin: () => void;
  onLeave: () => void;
}

export function EventCard({ event, detail, busy, error, onJoin, onLeave }: EventCardProps) {
  const theme = useTheme();
  // Keyed by event, so switching events never shows the previous event's address.
  const [resolved, setResolved] = useState<{ eventId: string; address: string } | null>(null);
  const address = resolved?.eventId === event.id ? resolved.address : null;

  useEffect(() => {
    let current = true;
    lookupAddress(event.location).then((a) => current && setResolved({ eventId: event.id, address: a }));
    return () => {
      current = false;
    };
  }, [event.id, event.location]);

  return (
    <View style={styles.container}>
      <SitePhoto photo={event.photo} style={styles.photo} label={`Photo of the cleanup site for ${event.title}`} />

      <View style={styles.heading}>
        <ThemedText style={styles.title}>{event.title}</ThemedText>
        <View style={styles.chips}>
          <Chip label={TIER_LABELS[event.difficultyTier]} />
          <Chip label={`Up to ${event.maxXp.toLocaleString()} XP`} highlight />
          {event.status === 'active' && <Chip label="Happening now" />}
        </View>
      </View>

      <View style={styles.facts}>
        <Fact label="Where" value={address ?? 'Finding address…'} />
        <Fact
          label="When"
          value={`${formatEventTime(event.scheduledStart, event.scheduledEnd)} (${formatDuration(event.scheduledStart, event.scheduledEnd)})`}
        />
        <Fact label="Organizer" value={`@${event.organizer.username}`} />
      </View>

      <ThemedText style={styles.description}>{event.description}</ThemedText>

      {event.isOrganizer ? (
        <ThemedView type="backgroundElement" style={styles.notice}>
          <ThemedText type="smallBold">{"You're organizing this cleanup"}</ThemedText>
        </ThemedView>
      ) : event.joined ? (
        <View style={styles.joinedRow}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            {"You're going"}
          </ThemedText>
          <Pressable onPress={onLeave} disabled={busy} accessibilityRole="button" hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary">
              Leave
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onJoin}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, { backgroundColor: theme.tint }, (pressed || busy) && styles.pressed]}>
          {busy ? (
            <ActivityIndicator color={theme.onTint} />
          ) : (
            <ThemedText themeColor="onTint" style={styles.buttonLabel}>
              Join cleanup
            </ThemedText>
          )}
        </Pressable>
      )}

      {error && (
        <ThemedText type="small" themeColor="error" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}

      <View style={styles.attendees}>
        <ThemedText type="smallBold">
          Attendees ({detail?.attendeeCount ?? event.attendeeCount})
        </ThemedText>
        {event.isOrganizer && (
          <ThemedText type="small" themeColor="textSecondary">
            {"Only you can see attendees' emails."}
          </ThemedText>
        )}
        {detail ? (
          detail.attendees.map((attendee) => (
            <View key={attendee.user.id} style={styles.attendee}>
              <ThemedText>
                @{attendee.user.username}
                {attendee.isOrganizer && <ThemedText themeColor="textSecondary"> (organizer)</ThemedText>}
              </ThemedText>
              {attendee.email && (
                <ThemedText type="small" themeColor="textSecondary" selectable>
                  {attendee.email}
                </ThemedText>
              )}
            </View>
          ))
        ) : (
          <ActivityIndicator color={theme.textSecondary} style={styles.loading} />
        )}
      </View>
    </View>
  );
}

// The site photo, or a labeled placeholder box when there is no photo (sample events).
export function SitePhoto({
  photo,
  style,
  label,
}: {
  photo: CleanupEvent['photo'];
  style: StyleProp<ImageStyle>;
  label?: string;
}) {
  const theme = useTheme();
  if (!photo.url) {
    return (
      <ThemedView type="backgroundSelected" style={[style as StyleProp<ViewStyle>, styles.photoPlaceholder]}>
        <ThemedText type="small" themeColor="textSecondary">
          Site photo
        </ThemedText>
      </ThemedView>
    );
  }
  return (
    <Image
      source={{ uri: photo.url, cacheKey: photo.id }}
      style={[style, { backgroundColor: theme.backgroundElement }]}
      contentFit="cover"
      accessibilityLabel={label}
    />
  );
}

function Chip({ label, highlight }: { label: string; highlight?: boolean }) {
  const theme = useTheme();
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.chip, highlight && { backgroundColor: theme.tint }]}>
      <ThemedText type="smallBold" themeColor={highlight ? 'onTint' : 'text'}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.factLabel}>
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
  photo: {
    height: 180,
    borderRadius: Spacing.three,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heading: {
    gap: Spacing.two,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: 700,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  facts: {
    gap: Spacing.two,
  },
  fact: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  factLabel: {
    width: 76,
  },
  factValue: {
    flex: 1,
  },
  description: {
    lineHeight: 22,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.two + Spacing.one,
    alignItems: 'center',
  },
  joinedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: Spacing.two + Spacing.one,
  },
  buttonLabel: {
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.7,
  },
  attendees: {
    gap: Spacing.two,
  },
  attendee: {
    gap: Spacing.half,
  },
  loading: {
    alignSelf: 'flex-start',
  },
});
