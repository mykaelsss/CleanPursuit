import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type StepHeadingProps = {
  number: number;
  title: string;
};

export default function StepHeading({ number, title }: StepHeadingProps) {
  const theme = useTheme();

  return (
    <View style={styles.heading}>
      <View style={[styles.number, { backgroundColor: theme.primary }]}>
        <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
          {number}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={styles.title}>
        {title}
      </ThemedText>
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
    letterSpacing: 1.2,
  },
});
