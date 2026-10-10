import { StyleSheet, View } from "react-native";

import AppBadge from "@/components/app-badge";
import AppCard from "@/components/app-card";
import ScreenLayout from "@/components/screen-layout";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";

export default function ProfileScreen() {
  const theme = useTheme();

  const player = {
    name: "Staceyann King",
    location: "Queens, NY",
    initials: "SK",
    title: "Neighborhood Explorer",
    level: 1,
    xp: 0,
    nextLevelXp: 100,
  };

  const progress =
    player.nextLevelXp > 0
      ? Math.min(Math.max(player.xp / player.nextLevelXp, 0), 1)
      : 0;

  return (
    <ScreenLayout
      title="Profile"
      headerContent={
        <ThemedView
          type="backgroundElement"
          style={[styles.profilePicture, { borderColor: theme.earth }]}
        >
          <ThemedText type="subtitle">{player.initials}</ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            {player.title}
          </ThemedText>
        </ThemedView>
      }
    >
      <View style={styles.playerHeading}>
        <View style={styles.details}>
          <ThemedText type="subtitle">{player.name}</ThemedText>

          <ThemedText themeColor="textSecondary">{player.location}</ThemedText>
        </View>

        <AppBadge label={`LEVEL ${player.level}`} />
      </View>

      <AppCard
        title="Adventure progress"
        rightContent={
          <ThemedText type="small" themeColor="textSecondary">
            {player.xp} / {player.nextLevelXp} XP
          </ThemedText>
        }
      >
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Progress toward the next level"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(progress * 100),
            text: `${player.xp} of ${player.nextLevelXp} XP`,
          }}
          style={[
            styles.progressTrack,
            { backgroundColor: theme.backgroundSelected },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress * 100}%`,
                backgroundColor: theme.accent,
              },
            ]}
          />
        </View>

        <ThemedText type="small" themeColor="textSecondary">
          Complete cleanup quests to earn XP and level up.
        </ThemedText>
      </AppCard>

      <AppCard title="About me">
        <ThemedText>
          Hi! I’m Staceyann. Let’s explore NYC, take on cleanup quests, and make
          our neighborhoods cleaner.
        </ThemedText>
      </AppCard>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  profilePicture: {
    width: "100%",
    height: 220,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  playerHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  details: {
    flexShrink: 1,
    gap: 8,
  },
  progressTrack: {
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 6,
  },
});
