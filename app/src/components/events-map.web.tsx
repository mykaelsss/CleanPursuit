import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { EventsMapProps } from '@/components/events-map';
import { Spacing } from '@/constants/theme';

// react-native-maps has no web version, so web shows the event list without a map.
export function EventsMap(_props: EventsMapProps) {
  return (
    <View style={styles.container}>
      <ThemedText themeColor="textSecondary" style={styles.text}>
        The events map is available in the CleanPursuit mobile app.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  text: {
    textAlign: 'center',
  },
});
