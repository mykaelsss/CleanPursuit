import { Pressable, StyleSheet, View } from "react-native";

import AppBadge from "@/components/app-badge";
import AppCard from "@/components/app-card";
import BountyPoster from "@/components/bounty-poster";
import { squish } from "@/components/quest-ui";
import ScreenLayout from "@/components/screen-layout";
import { ThemedText } from "@/components/themed-text";
import { MIN_TOUCH } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";

export default function ProfileScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  // The tabs only render while signed in, but the user can briefly be null.
  if (!user) return null;

  const { level } = user;
  const next = level.xpForNextLevel;
  const atMaxLevel = next === null;
  const progress = atMaxLevel
    ? 1
    : Math.min(Math.max(level.xpIntoLevel / next, 0), 1);
  const progressText = atMaxLevel
    ? "Max level"
    : `${level.xpIntoLevel} / ${next} XP`;
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <ScreenLayout
      title="Profile"
      headerContent={
        <BountyPoster
          name={user.username}
          initials={user.username.slice(0, 2).toUpperCase()}
          title="Neighborhood Explorer"
          bounty={user.totalXp}
        />
      }
    >
      <View style={styles.playerHeading}>
        <View style={styles.details}>
          <ThemedText type="subtitle">{user.username}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Member since {memberSince}
          </ThemedText>
        </View>

        <AppBadge label={`LEVEL ${level.number}`} />
      </View>

      <AppCard
        title="Adventure progress"
        rightContent={
          <ThemedText type="small" themeColor="textSecondary">
            {progressText}
          </ThemedText>
        }
      >
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={
            atMaxLevel ? "Max level reached" : "Progress toward the next level"
          }
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(progress * 100),
            text: atMaxLevel
              ? "Max level"
              : `${level.xpIntoLevel} of ${next} XP`,
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
          {atMaxLevel
            ? "You reached the top level. Your XP still counts on the leaderboards."
            : "Complete cleanup quests to earn XP and level up."}
        </ThemedText>
      </AppCard>

      <Pressable
        onPress={signOut}
        accessibilityRole="button"
        style={squish([styles.logOut, { borderColor: theme.border }])}
      >
        <ThemedText type="smallBold" themeColor="error">
          Log out
        </ThemedText>
      </Pressable>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
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
  // Set apart from the progress content so it reads as an account action, not part of the game.
  logOut: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: MIN_TOUCH,
    marginTop: 16,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1.5,
  },
});
