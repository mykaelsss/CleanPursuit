import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  // Primary fills with the tint color; secondary is outlined.
  variant?: 'primary' | 'secondary';
  accessibilityHint?: string;
};

export default function AppButton({ label, onPress, variant = 'primary', accessibilityHint }: AppButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: theme.tint } : { borderColor: theme.tint, borderWidth: 1 },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" themeColor={primary ? 'onTint' : 'tint'} selectable={false}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two + Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
});
