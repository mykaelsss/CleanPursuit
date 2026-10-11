import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  type TabTriggerSlotProps,
  type TabListProps,
  type TabsDescriptor,
  type TabsSlotRenderOptions,
} from "expo-router/ui";
import { Pressable, View, StyleSheet, type ViewStyle } from "react-native";

import { ThemedText } from "./themed-text";
import { ThemedView } from "./themed-view";
import { useTheme } from "@/hooks/use-theme";

export default function AppTabs() {
  return (
    <Tabs style={styles.tabs}>
      <TabSlot
        style={styles.tabSlot}
        detachInactiveScreens={false}
        renderFn={renderScreen}
      />

      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="events" href="/events" asChild>
            <TabButton>Quests</TabButton>
          </TabTrigger>

          <TabTrigger name="create" href="/create" asChild>
            <TabButton>Create</TabButton>
          </TabTrigger>

          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton>Profile</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

// The default slot hides inactive screens with display: none, which collapses their layout to zero. The quest
// list's bottom sheet then measures an empty screen and visibly regrows each time the tab is shown again.
// Hiding with visibility keeps every screen laid out, and still removes it from the accessibility tree and
// the tab order.
function renderScreen(
  descriptor: TabsDescriptor,
  { isFocused, loaded }: TabsSlotRenderOptions,
) {
  // Screens stay unmounted until first opened, like the default slot.
  if (!loaded && !isFocused) return null;
  return (
    <View
      key={descriptor.route.key}
      style={[StyleSheet.absoluteFill, !isFocused && styles.inactiveScreen]}
      pointerEvents={isFocused ? "auto" : "none"}
    >
      {descriptor.render()}
    </View>
  );
}

export function TabButton({
  children,
  isFocused,
  ...props
}: TabTriggerSlotProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}
    >
      <ThemedView
        type={isFocused ? "backgroundSelected" : "backgroundElement"}
        style={styles.tabButtonView}
      >
        <ThemedText
          type="small"
          themeColor={isFocused ? "text" : "textSecondary"}
        >
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList({ children, style, ...props }: TabListProps) {
  const theme = useTheme();

  return (
    <View
      {...props}
      style={[
        style,
        styles.tabListContainer,
        { backgroundColor: theme.background },
      ]}
    >
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        {children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flex: 1,
    flexDirection: "column",
  },
  tabSlot: {
    flex: 1,
    minHeight: 0,
  },
  // React Native Web passes visibility through to CSS, but React Native's style types don't include it.
  inactiveScreen: { visibility: "hidden" } as ViewStyle,
  tabListContainer: {
    width: "100%",
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  innerContainer: {
    width: "100%",
    maxWidth: 420,
    padding: 8,
    borderRadius: 24,
    flexDirection: "row",
    gap: 8,
  },
  tabButton: {
    flex: 1,
  },
  tabButtonView: {
    paddingVertical: 12,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
