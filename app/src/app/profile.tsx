import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={{
        paddingBottom: insets.bottom + BottomTabInset + 24,
      }}
    >
      <View style={styles.header}>
        <View style={styles.headerBackground} />

        <View
          style={[
            styles.headerContent,
            {
              paddingTop: Platform.OS === "web" ? 24 : insets.top + 24,
            },
          ]}
        >
          <ThemedText type="smallBold" style={styles.brand}>
            CLEANPURSUIT
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.profilePicture}>
            <ThemedText type="subtitle">SK</ThemedText>
          </ThemedView>
        </View>

        {/* Lower background curves upward into the header */}
        <View
          pointerEvents="none"
          style={[styles.reverseCurve, { backgroundColor: theme.background }]}
        />
      </View>

      <View style={styles.body}>
        <View style={styles.details}>
          <ThemedText type="subtitle">Staceyann King</ThemedText>

          <ThemedText themeColor="textSecondary">Queens, NY</ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.aboutCard}>
          <View style={styles.cardHeader}>
            <ThemedText type="smallBold">About me</ThemedText>

            <ThemedText themeColor="textSecondary">XP: 0</ThemedText>
          </View>

          <ThemedText>
            Hi! I’m Staceyann. Welcome to my CleanPursuit profile.
          </ThemedText>
        </ThemedView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    width: "100%",
    position: "relative",
    alignItems: "center",
    paddingBottom: 64,
  },
  headerContent: {
    width: "100%",
    maxWidth: 420,
    paddingHorizontal: 24,
    gap: 16,
  },
  headerBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#27272A",
  },

  brand: {
    letterSpacing: 2,
    color: "#FFFFFF",
  },
  profilePicture: {
    width: "100%",
    height: 240,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#52525B",
  },
  reverseCurve: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 48,
    borderTopLeftRadius: 100,
    borderTopRightRadius: 100,
  },
  body: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 16,
  },
  details: {
    gap: 8,
  },
  aboutCard: {
    padding: 20,
    borderRadius: 16,
    gap: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
