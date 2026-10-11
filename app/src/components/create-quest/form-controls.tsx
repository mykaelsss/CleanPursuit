import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

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

const styles = StyleSheet.create({
  field: { gap: 8 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 16 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: 12,
    alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
});
