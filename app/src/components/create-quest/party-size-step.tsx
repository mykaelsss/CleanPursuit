import { Pressable, StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import QuestIcon from '@/components/create-quest/quest-icon';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

const MIN_PARTY_SIZE = 1;
const MAX_PARTY_SIZE = 10;

type PartySizeStepProps = {
  value: number;
  onChange: (value: number) => void;
};

export default function PartySizeStep({ value, onChange }: PartySizeStepProps) {
  const theme = useTheme();

  return (
    <AppCard>
      <StepHeading number={4} title="BUILD YOUR PARTY" />
      <View style={styles.intro}>
        <View style={[styles.icon, { backgroundColor: theme.highlight }]}>
          <QuestIcon name="people" color={theme.text} size={28} />
        </View>
        <View style={styles.copy}>
          <ThemedText type="smallBold">Recommended party size</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This is a friendly target, not a sign-up limit.
          </ThemedText>
        </View>
      </View>

      <View style={[styles.stepper, { backgroundColor: theme.background }]}>
        <StepperButton
          label="Decrease recommended party size"
          symbol="-"
          disabled={value <= MIN_PARTY_SIZE}
          onPress={() => onChange(Math.max(MIN_PARTY_SIZE, value - 1))}
        />
        <View style={styles.value}>
          <ThemedText type="title" style={styles.number}>
            {value}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {value === 1 ? 'volunteer' : 'volunteers'}
          </ThemedText>
        </View>
        <StepperButton
          label="Increase recommended party size"
          symbol="+"
          disabled={value >= MAX_PARTY_SIZE}
          onPress={() => onChange(Math.min(MAX_PARTY_SIZE, value + 1))}
        />
      </View>

      <View style={[styles.tip, { backgroundColor: theme.highlight }]}>
        <ThemedText type="smallBold" style={{ color: theme.text }}>
          💡 Party tip
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {partyTip(value)}
        </ThemedText>
      </View>
    </AppCard>
  );
}

function StepperButton({
  label,
  symbol,
  disabled,
  onPress,
}: {
  label: string;
  symbol: '-' | '+';
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepperButton,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <ThemedText type="subtitle">{symbol}</ThemedText>
    </Pressable>
  );
}

function partyTip(size: number) {
  if (size <= 4) return 'A nimble crew is great for a focused neighborhood cleanup.';
  if (size <= 8) return 'A team this size can split into pairs and cover more ground.';
  return 'For a larger party, plan a quick welcome and clear team zones.';
}

const styles = StyleSheet.create({
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  stepper: {
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    alignItems: 'center',
  },
  number: {
    fontSize: 38,
    lineHeight: 42,
  },
  tip: {
    borderRadius: 12,
    padding: 13,
    gap: 2,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.72,
  },
});
