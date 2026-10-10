import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type BountyPosterProps = {
  name: string;
  initials: string;
  title: string;
  bounty: number;
};

// A One Piece style wanted poster, torn at the top and bottom like it was
// ripped off a bounty board.
export default function BountyPoster({
  name,
  initials,
  title,
  bounty,
}: BountyPosterProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(DESIGN_WIDTH);
  const ink = { color: theme.posterInk };
  const amount = formatBounty(bounty);
  const posterName = name.trim().toUpperCase().split(/\s+/).join("·");

  // Text scales with the poster so it fits the same way on every screen.
  // adjustsFontSizeToFit would do this on native, but it does nothing on web.
  const scale = width / DESIGN_WIDTH;
  const size = (fontSize: number, lineHeight = 1.15) => ({
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
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.poster}
    >
      <TornEdge side="top" />

      <View
        style={[
          styles.paper,
          {
            backgroundColor: theme.poster,
            paddingHorizontal: PAPER_PADDING * scale,
          },
        ]}
      >
        <Text
          style={[styles.wanted, size(54, 1.05), { letterSpacing: scale }, ink]}
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
          <Text style={[styles.initials, size(64), ink]}>{initials}</Text>
        </View>

        <Text style={[styles.deadOrAlive, size(24), ink]}>DEAD OR ALIVE</Text>

        <Text style={[styles.name, size(nameSize), ink]} numberOfLines={1}>
          {posterName}
        </Text>

        <Text style={[styles.bounty, size(28), ink]} numberOfLines={1}>
          <Text style={styles.currency}>XP </Text>
          {amount}-
        </Text>

        <View style={styles.footer}>
          <Text style={[styles.finePrint, size(7, 1.3), ink]}>
            KNOWN AS THE {title.toUpperCase()}. WANTED FOR CLEANING UP THE
            NEIGHBORHOOD. REWARD PAID IN XP.
          </Text>

          <Text style={[styles.issuer, size(18), ink]}>CLEANPURSUIT</Text>
        </View>
      </View>

      <TornEdge side="bottom" />
    </View>
  );
}

function formatBounty(xp: number) {
  return String(Math.max(0, Math.floor(xp))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
}

// The edge is drawn in a 100 x 10 box that stretches to the poster's width.
// y = 10 meets the paper, and smaller values reach further out.
function tornPath(seed: number, inset: number) {
  // Seeded so the tear has the same shape on every render.
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  const span = 9 - inset;
  // Mostly shallow jags, with the odd deep bite where the paper ripped away.
  const depth = () => {
    const bite = random() < 0.12 ? 0.75 + random() * 0.25 : random() * 0.55;
    return (inset + (1 - bite) * span).toFixed(2);
  };

  let path = "M0 10";
  for (let x = 0; x < 100; x += 0.6 + random() * 2.8) {
    path += ` L${x.toFixed(2)} ${depth()}`;
  }
  return `${path} L100 ${depth()} L100 10 Z`;
}

// Each edge has a pale fiber layer under a ragged paper layer, like the
// exposed fibers along a real tear.
const EDGES = {
  top: { fiber: tornPath(7, 0), paper: tornPath(11, 2) },
  bottom: { fiber: tornPath(23, 0), paper: tornPath(41, 2) },
};

function TornEdge({ side }: { side: keyof typeof EDGES }) {
  const theme = useTheme();
  const { fiber, paper } = EDGES[side];

  return (
    <Svg
      width="100%"
      height={EDGE_HEIGHT}
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      style={side === "top" ? styles.topEdge : styles.bottomEdge}
    >
      <Path d={fiber} fill={theme.posterFiber} />
      <Path d={paper} fill={theme.poster} />
    </Svg>
  );
}

// The poster is laid out at this width and its text scales from there.
const DESIGN_WIDTH = 330;
const PAPER_PADDING = 18;
const NAME_WIDTH = DESIGN_WIDTH - PAPER_PADDING * 2;
const EDGE_HEIGHT = 22;

const styles = StyleSheet.create({
  poster: {
    width: "88%",
    alignSelf: "center",
    transform: [{ rotate: "-1.5deg" }],
  },
  // Overlap the paper by a pixel so no seam shows between edge and paper.
  topEdge: {
    marginBottom: -1,
  },
  bottomEdge: {
    marginTop: -1,
    transform: [{ scaleY: -1 }],
  },
  paper: {
    paddingTop: 4,
    paddingBottom: 8,
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
