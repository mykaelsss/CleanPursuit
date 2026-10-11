import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { displayStyles, LiveBadge, onSiteText, squish } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { MIN_TOUCH, Spacing } from '@/constants/theme';
import { useAnnounce } from '@/hooks/use-announce';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type Party, type WalkUp } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { PhotoProgress } from '@/lib/report-photo';
import { useWalkUp, type EndOutcome } from '@/lib/walk-up';

// Keep in sync with WALK_UP_SLOT_MINUTES and the geofence in the API (docs/mvp.md).
const FULL_XP_MINUTES = 60;
const GEOFENCE_METERS = 100;
const MAX_BAGS = 99;

export type WalkUpChange = 'checkedIn' | 'left' | 'ended';

interface WalkUpPanelProps {
  questId: string;
  // The quest's walk-up under way, as the API last reported it.
  walkUp: WalkUp | null;
  maxXp: number;
  hot: boolean;
  // `ink` when the panel is the card's main call to action; `plain` when it sits below an event's.
  tone: 'ink' | 'plain';
  // What the panel says when nobody is on site.
  idle: { title: string; text: string; action: string };
  // More actions for when nobody is on site, such as scheduling a party.
  children?: ReactNode;
  onChange: (change: WalkUpChange) => void;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return "Can't reach CleanPursuit. Check your connection.";
}

function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// A quest's walk-up cleanup: check in at the spot to start or join one, then leave, or end it with an
// after photo as its leader.
export function WalkUpPanel({ questId, walkUp, maxXp, hot, tone, idle, children, onChange }: WalkUpPanelProps) {
  const theme = useTheme();
  const { user } = useAuth();
  const session = useWalkUp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState<Party | null>(null);
  useAnnounce(error);

  const colors =
    tone === 'ink'
      ? {
          panel: { backgroundColor: theme.ink },
          title: theme.reward,
          text: theme.onInkSoft,
          strong: theme.onInk,
          primary: theme.reward,
          onPrimary: theme.onReward,
          secondary: theme.onInkSoft,
          onSecondary: theme.onInk,
        }
      : {
          panel: { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 },
          title: theme.text,
          text: theme.textSecondary,
          strong: theme.text,
          primary: theme.tint,
          onPrimary: theme.onTint,
          secondary: theme.tint,
          onSecondary: theme.tint,
        };

  const mine = session.party?.questId === questId ? session.party : null;
  const reward = `Up to ${maxXp.toLocaleString()} XP for ${FULL_XP_MINUTES} minutes on site.`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const checkIn = () =>
    run(async () => {
      const party = await session.checkIn(questId);
      const leading = party.leader.id === user?.id;
      AccessibilityInfo.announceForAccessibility(
        leading ? "You're checked in and leading the cleanup" : "You're checked in",
      );
      onChange('checkedIn');
    });

  const leave = () =>
    run(async () => {
      await session.leave();
      AccessibilityInfo.announceForAccessibility('You left the cleanup');
      onChange('left');
    });

  if (ended) {
    const completed = ended.status === 'completed';
    return (
      <View style={[styles.panel, colors.panel]} accessible>
        <ThemedText style={[displayStyles.base, styles.title, { color: colors.title }]}>
          {completed ? 'Quest complete' : 'Cleanup ended'}
        </ThemedText>
        <ThemedText type="small" style={{ color: colors.text }}>
          {completed
            ? 'Everyone who was on site earns XP for their time there.'
            : 'Everyone who was on site earns XP for their time there. The quest stays open for the next group.'}
        </ThemedText>
      </View>
    );
  }

  if (mine) {
    // The card reloads the quest's walk-up when it opens, which is fresher than the check-in response
    // after others join or the lead is handed off.
    const fresh = walkUp?.partyId === mine.id ? walkUp : null;
    const leader = fresh?.leader ?? mine.leader;
    const onSiteCount = fresh?.checkedInCount ?? mine.members.filter((m) => m.status === 'checked_in').length;
    const leading = leader.id === user?.id;
    const me = mine.members.find((member) => member.userId === user?.id);
    const status =
      session.onSite === false
        ? `You're more than ${GEOFENCE_METERS} m from the spot. Head back to keep earning XP.`
        : 'Your time on site counts toward XP. Keep the app open so it can tell you are here.';

    return (
      <View style={[styles.panel, colors.panel]}>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <ThemedText style={[displayStyles.base, styles.title, styles.grow, { color: colors.title }]}>
              {"You're checked in"}
            </ThemedText>
            <LiveBadge count={onSiteCount} />
          </View>
          <ThemedText type="small" style={{ color: colors.strong }}>
            {leading ? "You're leading this cleanup." : `@${leader.username} is leading this cleanup.`}
            {me?.checkedInAt ? ` You checked in at ${timeOfDay(me.checkedInAt)}.` : ''}
          </ThemedText>
          <ThemedText type="small" style={{ color: session.onSite === false ? theme.error : colors.text }}>
            {status}
          </ThemedText>
          {hot ? (
            <ThemedText type="small" style={{ color: colors.text }}>
              This spot is a hotspot, so finishing the cleanup earns bonus XP.
            </ThemedText>
          ) : null}
        </View>

        {ending ? (
          <EndForm
            colors={colors}
            onCancel={() => setEnding(false)}
            onEnded={(party) => {
              setEnded(party);
              setEnding(false);
              AccessibilityInfo.announceForAccessibility(
                party.status === 'completed' ? 'Quest complete' : 'Cleanup ended',
              );
              onChange('ended');
            }}
          />
        ) : (
          <View style={styles.actions}>
            {leading ? (
              <PrimaryButton
                label="End cleanup"
                color={colors.primary}
                onColor={colors.onPrimary}
                onPress={() => setEnding(true)}
                disabled={busy}
              />
            ) : null}
            {leading && onSiteCount > 1 ? (
              <ThemedText type="small" style={{ color: colors.text }}>
                If you leave, whoever checked in first after you leads instead.
              </ThemedText>
            ) : null}
            <SecondaryButton
              label="Leave cleanup"
              color={colors.secondary}
              onColor={colors.onSecondary}
              onPress={leave}
              busy={busy}
            />
          </View>
        )}

        {error ? (
          <ThemedText type="small" style={{ color: theme.error }}>
            {error}
          </ThemedText>
        ) : null}
      </View>
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
        <PrimaryButton
          label={walkUp ? 'Check in and join' : idle.action}
          hint={`You need to be within ${GEOFENCE_METERS} m of the spot`}
          color={colors.primary}
          onColor={colors.onPrimary}
          onPress={checkIn}
          busy={busy}
        />
        <ThemedText type="small" style={{ color: colors.text }} importantForAccessibility="no" accessibilityElementsHidden>
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

type PanelColors = {
  text: string;
  strong: string;
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
};

// The leader's last step: an after photo, the bag count, and whether the spot is clean.
function EndForm({
  colors,
  onCancel,
  onEnded,
}: {
  colors: PanelColors;
  onCancel: () => void;
  onEnded: (party: Party) => void;
}) {
  const theme = useTheme();
  const session = useWalkUp();
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  // Kept across retries so a finished upload is not repeated.
  const progress = useRef<PhotoProgress>({});
  const [bags, setBags] = useState(1);
  const [outcome, setOutcome] = useState<EndOutcome>('completed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAnnounce(error);

  async function choosePhoto(source: 'camera' | 'library') {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera access needed', 'Allow camera access to photograph the cleaned-up spot.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      setPhoto(result.assets[0]);
      progress.current = {};
    } catch {
      Alert.alert('Photo unavailable', 'We could not open your camera or photo library. Please try again.');
    }
  }

  async function submit() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      onEnded(await session.end({ photo, progress: progress.current, bagCount: bags, outcome }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <ThemedText type="smallBold" style={{ color: colors.strong }}>
          After photo
        </ThemedText>
        {photo ? (
          <Image
            source={{ uri: photo.uri }}
            style={styles.preview}
            contentFit="cover"
            accessibilityLabel="Your after photo of the spot"
          />
        ) : (
          <ThemedText type="small" style={{ color: colors.text }}>
            Show the spot after the cleanup. Everyone on site earns XP once it is in.
          </ThemedText>
        )}
        <View style={styles.row}>
          <SecondaryButton
            label={photo ? 'Retake' : 'Take photo'}
            color={colors.secondary}
            onColor={colors.onSecondary}
            onPress={() => choosePhoto('camera')}
            disabled={busy}
            grow
          />
          <SecondaryButton
            label="Choose photo"
            color={colors.secondary}
            onColor={colors.onSecondary}
            onPress={() => choosePhoto('library')}
            disabled={busy}
            grow
          />
        </View>
      </View>

      <View style={styles.field}>
        <ThemedText type="smallBold" style={{ color: colors.strong }}>
          Bags filled
        </ThemedText>
        <View
          style={styles.stepper}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Bags filled"
          accessibilityValue={{ now: bags, min: 0, max: MAX_BAGS }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={({ nativeEvent }) =>
            setBags((n) => Math.min(MAX_BAGS, Math.max(0, n + (nativeEvent.actionName === 'increment' ? 1 : -1))))
          }>
          <StepButton
            label="−"
            color={colors.secondary}
            onColor={colors.onSecondary}
            onPress={() => setBags((n) => Math.max(0, n - 1))}
            disabled={busy || bags === 0}
          />
          <ThemedText style={[displayStyles.base, styles.count, { color: colors.strong }]}>{bags}</ThemedText>
          <StepButton
            label="+"
            color={colors.secondary}
            onColor={colors.onSecondary}
            onPress={() => setBags((n) => Math.min(MAX_BAGS, n + 1))}
            disabled={busy || bags === MAX_BAGS}
          />
        </View>
      </View>

      <View style={styles.field} accessibilityRole="radiogroup">
        <ThemedText type="smallBold" style={{ color: colors.strong }}>
          Is the spot clean?
        </ThemedText>
        <View style={styles.row}>
          {(
            [
              ['completed', 'All clean'],
              ['partial', 'More to do'],
            ] as const
          ).map(([value, label]) => {
            const chosen = outcome === value;
            return (
              <Pressable
                key={value}
                onPress={() => setOutcome(value)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen, disabled: busy }}
                style={squish([
                  styles.choice,
                  { borderColor: colors.secondary },
                  chosen && { backgroundColor: colors.primary, borderColor: colors.primary },
                ])}>
                <ThemedText type="smallBold" style={{ color: chosen ? colors.onPrimary : colors.onSecondary }}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <ThemedText type="small" style={{ color: colors.text }}>
          {outcome === 'completed'
            ? 'This completes the quest and closes it for everyone.'
            : 'The quest stays open so the next group can finish it.'}
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label="End cleanup and award XP"
          color={colors.primary}
          onColor={colors.onPrimary}
          onPress={submit}
          busy={busy}
          disabled={!photo}
          hint={photo ? undefined : 'Add an after photo first'}
        />
        <SecondaryButton
          label="Not yet"
          color={colors.secondary}
          onColor={colors.onSecondary}
          onPress={onCancel}
          disabled={busy}
        />
      </View>

      {error ? (
        <ThemedText type="small" style={{ color: theme.error }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

function PrimaryButton({
  label,
  hint,
  color,
  onColor,
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  hint?: string;
  color: string;
  onColor: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy }}
      style={squish([styles.primaryButton, { backgroundColor: color }, off && styles.dim])}>
      {busy ? (
        <ActivityIndicator color={onColor} />
      ) : (
        <ThemedText style={[displayStyles.base, styles.primaryLabel, { color: onColor }]}>{label}</ThemedText>
      )}
    </Pressable>
  );
}

function SecondaryButton({
  label,
  color,
  onColor,
  onPress,
  busy = false,
  disabled = false,
  grow = false,
}: {
  label: string;
  color: string;
  onColor: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  grow?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      style={squish([styles.secondaryButton, { borderColor: color }, grow && styles.grow, off && styles.dim])}>
      {busy ? (
        <ActivityIndicator color={onColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: onColor }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

// The stepper's buttons are for touch; screen readers adjust the stepper itself.
function StepButton({
  label,
  color,
  onColor,
  onPress,
  disabled,
}: {
  label: string;
  color: string;
  onColor: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={squish([styles.step, { borderColor: color }, disabled && styles.dim])}>
      <ThemedText style={[displayStyles.base, styles.stepLabel, { color: onColor }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: Spacing.three + Spacing.one,
    borderRadius: 20,
    gap: Spacing.three,
  },
  text: {
    gap: Spacing.one + Spacing.half,
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  grow: {
    flexGrow: 1,
  },
  actions: {
    gap: Spacing.two + Spacing.one,
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
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1.5,
  },
  dim: {
    opacity: 0.6,
  },
  form: {
    gap: Spacing.three + Spacing.one,
  },
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 14,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.three,
  },
  step: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: 24,
    lineHeight: 28,
  },
  count: {
    fontSize: 28,
    lineHeight: 34,
    minWidth: 36,
    textAlign: 'center',
  },
  choice: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1.5,
  },
});
