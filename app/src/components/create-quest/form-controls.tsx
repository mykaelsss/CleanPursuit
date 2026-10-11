import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import QuestIcon from '@/components/create-quest/quest-icon';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export function FormField({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        {...props}
        style={[styles.input, {
          backgroundColor: theme.background, borderColor: theme.border, color: theme.text,
        }, props.multiline && styles.multiline, props.style]}
      />
    </View>
  );
}

export function FormButton({ label, onPress, disabled = false }: {
  label: string; onPress: () => void; disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
      aria-disabled={disabled}
      onPress={onPress} style={({ pressed }) => [styles.button, { borderColor: theme.tint },
        (pressed || disabled) && styles.dim]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

// A confirmation the reporter must tick. While disabled, `hint` says what is still missing.
export function ConfirmCheck({ label, checked, disabled, hint, onPress }: {
  label: string; checked: boolean; disabled: boolean; hint?: string | null; onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }}
        accessibilityHint={disabled && hint ? hint : undefined}
        aria-checked={checked} aria-disabled={disabled} disabled={disabled} onPress={onPress}
        style={({ pressed }) => [styles.check, {
          backgroundColor: checked ? theme.sage : theme.background,
          borderColor: checked ? theme.tint : theme.border,
        }, disabled && styles.dim, pressed && styles.pressed]}>
        <View style={[styles.box, checked
          ? { backgroundColor: theme.tint, borderColor: theme.tint }
          : { borderColor: theme.textSecondary }]}>
          {checked ? <QuestIcon name="check" color={theme.onTint} size={16} /> : null}
        </View>
        <ThemedText type="smallBold" style={[styles.checkLabel, checked && { color: theme.sageText }]}>
          {label}
        </ThemedText>
      </Pressable>
      {disabled && hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 16 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: 12,
    alignItems: 'center', justifyContent: 'center' },
  check: { minHeight: 52, borderWidth: 1, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { flex: 1 },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
});
