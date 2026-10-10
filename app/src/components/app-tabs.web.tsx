import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
  type TabsDescriptor,
  type TabsSlotRenderOptions,
} from 'expo-router/ui';
import { Pressable, View, StyleSheet, type ViewStyle } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function AppTabs() {
  return (
    // The tab bar sits above the screens in the layout instead of floating over them, so it never covers content.
    <Tabs>
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="events" href="/events" asChild>
            <TabButton>Quests</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
      <TabSlot style={styles.slot} detachInactiveScreens={false} renderFn={renderScreen} />
    </Tabs>
  );
}

// The default slot hides inactive screens with display: none, which collapses their layout to zero. The quest
// list's bottom sheet then measures an empty screen and visibly regrows each time the tab is shown again.
// Hiding with visibility keeps every screen laid out, and still removes it from the accessibility tree and
// the tab order.
function renderScreen(descriptor: TabsDescriptor, { isFocused, loaded }: TabsSlotRenderOptions) {
  // Screens stay unmounted until first opened, like the default slot.
  if (!loaded && !isFocused) return null;
  return (
    <View
      key={descriptor.route.key}
      style={[StyleSheet.absoluteFill, !isFocused && styles.inactiveScreen]}
      pointerEvents={isFocused ? 'auto' : 'none'}>
      {descriptor.render()}
    </View>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <ThemedText type="smallBold" style={styles.brandText}>
          CleanPursuit
        </ThemedText>

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
  },
  // React Native Web passes visibility through to CSS, but React Native's style types don't include it.
  inactiveScreen: { visibility: 'hidden' } as ViewStyle,
  tabListContainer: {
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
