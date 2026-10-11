import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { displayStyles, LiveBadge, squish } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { MIN_TOUCH, Spacing } from '@/constants/theme';
import { useAnnounce } from '@/hooks/use-announce';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type Party } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLiveParty, type EndOutcome } from '@/lib/live-party';
import type { PhotoProgress } from '@/lib/report-photo';

// The pieces a quest's or event's card uses for a cleanup under way: being checked in, ending it with an
// after photo, and the result.

// Keep in sync with the geofence in the API (docs/mvp.md).
export const GEOFENCE_METERS = 100;
const MAX_BAGS = 99;

// What a card reports after the user checks in, leaves or ends a cleanup, so the screen can reload.
export type PartyChange = 'checkedIn' | 'left' | 'ended';

// `ink` when the panel is the card's main call to action; `plain` when it sits below another.
export type PanelTone = 'ink' | 'plain';

export type PanelColors = ReturnType<typeof usePanelColors>;

export function usePanelColors(tone: PanelTone) {
  const theme = useTheme();
  return tone === 'ink'
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
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return "Can't reach CleanPursuit. Check your connection.";
}

export function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Runs one of a panel's actions, keeping its busy state and error.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAnnounce(error);
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
  return { busy, error, run };
}

// Checking in to one cleanup leaves any other, so say so before the user checks in somewhere new.
export function OtherCleanupNote({ other, color }: { other: Party | null; color: string }) {
  const { user } = useAuth();
  if (!other) return null;
  return (
    <ThemedText type="small" style={{ color }}>
      {other.leader.id === user?.id
        ? "You're leading another cleanup. End it first to award its XP, since checking in here leaves it."
        : 'Checking in here leaves your other cleanup. You still earn XP for your time there when it ends.'}
    </ThemedText>
  );
}

interface CheckedInPanelProps {
  // The cleanup the user is checked in to, from useLiveParty.
  party: Party;
  // The card's freshest view of who leads and how many are on site.
  leader: { id: string; username: string };
  onSiteCount: number;
  tone: PanelTone;
  hot: boolean;
  // Said under the on-site status, such as that the time slot is over.
  note?: string | null;
  onLeft: () => void;
  onEnded: (party: Party) => void;
}

// Checked in to a cleanup: who leads, whether the user is on site, and Leave, or End for the leader.
export function CheckedInPanel({ party, leader, onSiteCount, tone, hot, note, onLeft, onEnded }: CheckedInPanelProps) {
  const theme = useTheme();
  const colors = usePanelColors(tone);
  const { user } = useAuth();
  const session = useLiveParty();
  const { busy, error, run } = useAction();
  const [ending, setEnding] = useState(false);

  const leading = leader.id === user?.id;
  const me = party.members.find((member) => member.userId === user?.id);
  const status =
    session.onSite === false
      ? `You're more than ${GEOFENCE_METERS} m from the spot. Head back to keep earning XP.`
      : 'Your time on site counts toward XP. Keep the app open so it can tell you are here.';

  const leave = () =>
    run(async () => {
      await session.leave();
      AccessibilityInfo.announceForAccessibility('You left the cleanup');
      onLeft();
    });

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
        {note ? (
          <ThemedText type="small" style={{ color: colors.strong }}>
            {note}
          </ThemedText>
        ) : null}
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
          onEnded={(ended) => {
            setEnding(false);
            AccessibilityInfo.announceForAccessibility(ended.status === 'completed' ? 'Quest complete' : 'Cleanup ended');
            onEnded(ended);
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

// How a cleanup turned out, shown on its card once it is over. The XP popup shows each member what they earned.
const ENDINGS: Partial<Record<Party['status'], { title: string; text: string }>> = {
  completed: { title: 'Quest complete', text: 'Everyone who checked in earns XP for their time on site.' },
  partial: {
    title: 'Cleanup ended',
    text: 'Everyone who checked in earns XP for their time on site. The quest stays open for the next group.',
  },
  abandoned: {
    title: 'Party over',
    text: 'Everyone left before the leader ended it with an after photo, so no XP was awarded.',
  },
  cancelled: {
    title: 'Party called off',
    text: "This party won't go ahead. The leader called it off, or another group finished the quest first.",
  },
};

export function isOver(status: Party['status']) {
  return status in ENDINGS;
}

export function EndedPanel({ status, tone }: { status: Party['status']; tone: PanelTone }) {
  const colors = usePanelColors(tone);
  const ending = ENDINGS[status] ?? ENDINGS.partial!;
  return (
    <View style={[styles.panel, colors.panel]} accessible>
      <ThemedText style={[displayStyles.base, styles.title, { color: colors.title }]}>{ending.title}</ThemedText>
      <ThemedText type="small" style={{ color: colors.text }}>
        {ending.text}
      </ThemedText>
    </View>
  );
}

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
  const session = useLiveParty();
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  // Kept across retries so a finished upload is not repeated.
  const progress = useRef<PhotoProgress>({});
  const [bags, setBags] = useState(1);
  const [outcome, setOutcome] = useState<EndOutcome>('completed');
  const { busy, error, run } = useAction();

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

  const submit = () =>
    run(async () => {
      if (!photo) return;
      onEnded(await session.end({ photo, progress: progress.current, bagCount: bags, outcome }));
    });

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
            Show the spot after the cleanup. Everyone who checked in earns XP once it is in.
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

export function PrimaryButton({
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

export function SecondaryButton({
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

export const panelStyles = StyleSheet.create({
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
});

const styles = StyleSheet.create({
  ...panelStyles,
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
