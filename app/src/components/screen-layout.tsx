import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import AppHeader from "@/components/app-header";
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
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={{ paddingBottom: BottomTabInset + 24 }}
    >
      <AppHeader size="hero">{headerContent}</AppHeader>

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
  container: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  body: {
    paddingTop: 8,
  },
  heading: {
    gap: 8,
  },
});
