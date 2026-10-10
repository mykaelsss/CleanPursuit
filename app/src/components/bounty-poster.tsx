import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import PosterPaper, { TEAR_DEPTH } from "@/components/poster-paper";
import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type BountyPosterProps = {
  name: string;
  initials: string;
  title: string;
  bounty: number;
};

// A One Piece style wanted poster on tea dyed paper, torn at the top and
// bottom like it was ripped off a bounty board.
export default function BountyPoster({
  name,
  initials,
  title,
  bounty,
}: BountyPosterProps) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: DESIGN_WIDTH, height: 0 });
  const { width } = size;
  const ink = { color: theme.posterInk };
  const amount = formatBounty(bounty);
  const posterName = name.trim().toUpperCase().split(/\s+/).join("·");

  // Text scales with the poster so it fits the same way on every screen.
  // adjustsFontSizeToFit would do this on native, but it does nothing on web.
  const scale = width / DESIGN_WIDTH;
  const text = (fontSize: number, lineHeight = 1.15) => ({
    fontSize: fontSize * scale,
    lineHeight: fontSize * scale * lineHeight,
  });
  // Long names shrink to stay on one line, like on a real poster.
  const nameSize = Math.min(34, NAME_WIDTH / (posterName.length * 0.8));

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Wanted poster for ${name}, bounty ${amount} XP`}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
      style={styles.poster}
    >
      <PosterPaper width={size.width} height={size.height} />

      <View
        style={[styles.content, { paddingHorizontal: PAPER_PADDING * scale }]}
      >
        <Text
          style={[styles.wanted, text(54, 1.05), { letterSpacing: scale }, ink]}
          numberOfLines={1}
        >
          WANTED
        </Text>

        <View
          style={[
            styles.photo,
            {
              backgroundColor: theme.posterPhoto,
              borderColor: theme.posterInk,
            },
          ]}
        >
          <Text style={[styles.initials, text(64), ink]}>{initials}</Text>
        </View>

        <Text style={[styles.deadOrAlive, text(24), ink]}>DEAD OR ALIVE</Text>

        <Text style={[styles.name, text(nameSize), ink]} numberOfLines={1}>
          {posterName}
        </Text>

        <Text style={[styles.bounty, text(28), ink]} numberOfLines={1}>
          <Text style={styles.currency}>XP </Text>
          {amount}-
        </Text>

        <View style={styles.footer}>
          <Text style={[styles.finePrint, text(7, 1.3), ink]}>
            KNOWN AS THE {title.toUpperCase()}. WANTED FOR CLEANING UP THE
            NEIGHBORHOOD. REWARD PAID IN XP.
          </Text>

          <Text style={[styles.issuer, text(18), ink]}>CLEANPURSUIT</Text>
        </View>
      </View>
    </View>
  );
}

function formatBounty(xp: number) {
  return String(Math.max(0, Math.floor(xp))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
}

// The poster is laid out at this width and its text scales from there.
const DESIGN_WIDTH = 330;
const PAPER_PADDING = 18;
const NAME_WIDTH = DESIGN_WIDTH - PAPER_PADDING * 2;

const styles = StyleSheet.create({
  poster: {
    width: "88%",
    alignSelf: "center",
    transform: [{ rotate: "-1.5deg" }],
  },
  // Keep the content clear of the torn edges.
  content: {
    paddingTop: TEAR_DEPTH + 6,
    paddingBottom: TEAR_DEPTH + 8,
    gap: 6,
  },
  wanted: {
    fontFamily: Fonts.serif,
    fontWeight: 900,
    textAlign: "center",
  },
  photo: {
    aspectRatio: 4 / 3,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontFamily: Fonts.serif,
    fontWeight: 900,
  },
  deadOrAlive: {
    fontFamily: Fonts.serif,
    fontWeight: 800,
    letterSpacing: 1,
    textAlign: "center",
  },
  name: {
    fontFamily: Fonts.serif,
    fontWeight: 800,
    textAlign: "center",
  },
  bounty: {
    fontWeight: 300,
    letterSpacing: 3,
  },
  currency: {
    fontFamily: Fonts.serif,
    fontWeight: 900,
    letterSpacing: 0,
  },
  footer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  finePrint: {
    flex: 1,
    fontFamily: Fonts.serif,
    fontWeight: 600,
  },
  issuer: {
    fontFamily: Fonts.serif,
    fontWeight: 900,
  },
});
