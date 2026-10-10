import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";

type AppCardProps = {
  title?: string;
  rightContent?: ReactNode;
  children: ReactNode;
};

export default function AppCard({
  title,
  rightContent,
  children,
}: AppCardProps) {
  const theme = useTheme();

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.card, { borderColor: theme.border }]}
    >
      {(title || rightContent) && (
        <View style={styles.header}>
          {title && <ThemedText type="smallBold">{title}</ThemedText>}

          {rightContent}
        </View>
      )}

      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
});
