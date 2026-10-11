import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/app-button';
import AppCard from '@/components/app-card';
import { ThemedText } from '@/components/themed-text';
import { RESOURCES } from '@/constants/resources';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openUrl } from '@/lib/open-url';

export default function ResourcesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}>
      <Stack.Screen options={{ title: 'Resources' }} />
      <ThemedText themeColor="textSecondary">
        Who to call and where to take things in New York City. If someone is in danger, call 911.
      </ThemedText>

      {RESOURCES.map((resource) => (
        <AppCard key={resource.title} title={resource.title}>
          <ThemedText type="small">{resource.body}</ThemedText>
          <View style={styles.links}>
            {resource.links.map((link, index) => (
              <AppButton
                key={link.url}
                label={link.label}
                variant={index === 0 ? 'primary' : 'secondary'}
                onPress={() => openUrl(link.url)}
              />
            ))}
          </View>
        </AppCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
