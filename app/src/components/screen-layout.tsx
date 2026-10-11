import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { BottomTabInset } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type ScreenLayoutProps = {
  title: string;
  subtitle?: string;
  headerContent?: ReactNode;
  children: ReactNode;
};

export default function ScreenLayout({
  title,
  subtitle,
  headerContent,
  children,
}: ScreenLayoutProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={{ paddingBottom: BottomTabInset + 24 }}
    >
      <View style={[styles.header, { backgroundColor: theme.header }]}>
        <View
          style={[
            styles.container,
            {
              paddingTop: Platform.OS === "web" ? 24 : insets.top + 24,
            },
          ]}
        >
          <ThemedText
            type="smallBold"
            style={[styles.brand, { color: theme.onPrimary }]}
          >
            CLEANPURSUIT
          </ThemedText>

          {headerContent}
        </View>

        <View
          pointerEvents="none"
          style={[styles.curve, { backgroundColor: theme.background }]}
        />
      </View>

      <View style={[styles.container, styles.body]}>
        <View style={styles.heading}>
          <ThemedText type="subtitle">{title}</ThemedText>

          {subtitle ? (
            <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>
          ) : null}
        </View>

        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    paddingBottom: 48,
    position: "relative",
  },
  container: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  brand: {
    letterSpacing: 2,
  },
  curve: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 32,
    borderTopLeftRadius: 100,
    borderTopRightRadius: 100,
  },
  body: {
    paddingTop: 8,
  },
  heading: {
    gap: 8,
  },
});
