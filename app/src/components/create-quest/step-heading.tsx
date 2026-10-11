import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import QuestIcon from '@/components/create-quest/quest-icon';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type StepHeadingProps = {
  number: number;
  title: string;
  // Swaps the number for a check mark once the step is complete.
  done?: boolean;
  rightContent?: ReactNode;
};

export default function StepHeading({ number, title, done = false, rightContent }: StepHeadingProps) {
  const theme = useTheme();

  return (
    <View style={styles.heading}>
      <View
        accessibilityLabel={done ? `Step ${number}, complete` : `Step ${number}`}
        style={[styles.number, { backgroundColor: done ? theme.tint : theme.primary }]}>
        {done ? (
          <QuestIcon name="check" color={theme.onTint} size={16} />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
            {number}
          </ThemedText>
        )}
      </View>
      <ThemedText accessibilityRole="header" type="smallBold" style={styles.title}>
        {title}
      </ThemedText>
      {rightContent}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  number: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
  },
});
