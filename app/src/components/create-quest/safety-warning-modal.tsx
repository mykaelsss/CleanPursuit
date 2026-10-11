import { Modal, Pressable, StyleSheet, View } from 'react-native';

import type { SafetyFlag } from '@/components/create-quest/constants';
import QuestIcon from '@/components/create-quest/quest-icon';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type SafetyWarningModalProps = {
  flag: SafetyFlag | undefined;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function SafetyWarningModal({ flag, onCancel, onConfirm }: SafetyWarningModalProps) {
  const theme = useTheme();

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(flag)}>
      <View style={styles.overlay}>
        <View
          accessibilityViewIsModal
          style={[
            styles.modal,
            { backgroundColor: theme.backgroundElement, borderColor: theme.error },
          ]}>
          <View style={[styles.icon, { backgroundColor: theme.reward }]}>
            <QuestIcon name="warning" color={theme.onReward} size={30} />
          </View>
          <View style={styles.copy}>
            <ThemedText type="subtitle" style={styles.title}>
              Warning
            </ThemedText>
            <ThemedText type="smallBold">
              This quest will be marked as {flag?.label.toLowerCase()}.
            </ThemedText>
            <ThemedText themeColor="textSecondary">{flag?.warning}</ThemedText>
            <ThemedText type="smallBold">
              Do you want to mark this quest with this warning?
            </ThemedText>
          </View>
          <View style={styles.actions}>
            <ModalButton label="No" onPress={onCancel} />
            <ModalButton danger label="Yes" onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ModalButton({ label, danger = false, onPress }: { label: string; danger?: boolean; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: danger ? theme.error : 'transparent',
          borderColor: danger ? theme.error : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={{ color: danger ? theme.onTint : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 24, 18, 0.62)',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    width: '100%',
    maxWidth: 390,
    borderWidth: 2,
    borderRadius: 24,
    padding: 22,
    gap: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 8,
  },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    gap: 10,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
