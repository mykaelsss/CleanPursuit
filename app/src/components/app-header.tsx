import type { ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";
import { DisplayFont, Spacing, type ThemeColor } from "@/constants/theme";

export const COMPACT_HEADER_HEIGHT = 56;

type AppHeaderProps = Omit<ViewProps, "children" | "style"> & {
  backgroundColor?: ThemeColor;
  brandColor?: ThemeColor;
  children?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  curveColor?: ThemeColor;
  separated?: boolean;
  size?: "compact" | "hero";
  style?: StyleProp<ViewStyle>;
};

export default function AppHeader({
  backgroundColor = "header",
  brandColor = "onPrimary",
  children,
  contentStyle,
  curveColor = "background",
  separated,
  size = "compact",
  style,
  ...viewProps
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const isHero = size === "hero";
  const showSeparator = separated ?? !isHero;
  const safeAreaTop = Platform.OS === "web" ? 0 : insets.top;
  const topPadding =
    Platform.OS === "web"
      ? isHero
        ? Spacing.four
        : Spacing.two
      : insets.top + (isHero ? Spacing.three : Spacing.one);

  return (
    <View
      {...viewProps}
      style={[
        styles.header,
        isHero ? styles.hero : styles.compact,
        showSeparator && styles.separated,
        {
          borderBottomColor: showSeparator ? theme.border : "transparent",
          backgroundColor: theme[backgroundColor],
          minHeight: isHero ? undefined : safeAreaTop + COMPACT_HEADER_HEIGHT,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.content,
          { paddingTop: topPadding },
          isHero ? styles.heroContent : styles.compactContent,
          contentStyle,
        ]}
      >
        <View style={styles.brandLockup}>
          <Text
            accessibilityRole="header"
            style={[styles.brand, { color: theme[brandColor] }]}
          >
            CLEANPURSUIT
          </Text>
          <View
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.brandAccent, { backgroundColor: theme[brandColor] }]}
          />
        </View>
        {children}
      </View>

      {isHero ? (
        <View
          pointerEvents="none"
          style={[styles.curve, { backgroundColor: theme[curveColor] }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    position: "relative",
    width: "100%",
  },
  compact: {
    justifyContent: "center",
    minHeight: COMPACT_HEADER_HEIGHT,
  },
  separated: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
  },
  hero: {
    paddingBottom: Spacing.five + Spacing.three,
  },
  content: {
    alignSelf: "center",
    maxWidth: 420,
    paddingHorizontal: Spacing.three,
    width: "100%",
  },
  compactContent: {
    paddingBottom: Spacing.two,
  },
  heroContent: {
    gap: Spacing.two,
  },
  brandLockup: {
    alignItems: "flex-start",
    gap: Spacing.one,
  },
  brand: {
    fontFamily: DisplayFont,
    fontSize: 22,
    letterSpacing: 1.5,
    lineHeight: 26,
  },
  brandAccent: {
    borderRadius: 2,
    height: 3,
    width: 36,
  },
  curve: {
    borderTopLeftRadius: 100,
    borderTopRightRadius: 100,
    bottom: -1,
    height: 32,
    left: 0,
    position: "absolute",
    right: 0,
  },
});
