import { Image, type ImageLoadEventData } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { squish } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { MIN_TOUCH, Spacing } from '@/constants/theme';
import type { CleanupEvent } from '@/lib/api';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
// How far, or how fast, a downward swipe has to go before it closes the viewer.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const SETTLE = { damping: 20, stiffness: 200 } as const;

// Photo viewers are black in light and dark mode alike, so the photo's own colors stand out.
const BACKDROP = '#000000';
const CONTROL = 'rgba(255, 255, 255, 0.16)';
const ON_BACKDROP = '#FFFFFF';

type Size = { width: number; height: number };

interface PhotoViewerProps {
  photo: CleanupEvent['photo'];
  visible: boolean;
  onClose: () => void;
  // Read to screen readers in place of the photo.
  label: string;
}

// A full screen photo. Pinch or double tap to zoom, drag to look around, and swipe down or press Close to go back.
export function PhotoViewer({ photo, visible, onClose, label }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);

  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const dismissY = useSharedValue(0);
  // Whether the fingers now on the screen have pinched, so lifting them never counts as a swipe away.
  const pinched = useSharedValue(false);
  // Where the photo was when the current gesture began, and the pinch's focal point.
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });
  // The screen and the photo fitted inside it, which bound how far a zoomed photo can move.
  const bounds = useSharedValue({ screenWidth: 1, screenHeight: 1, contentWidth: 1, contentHeight: 1 });

  // Each opening starts zoomed out and centered.
  useEffect(() => {
    if (!visible) return;
    scale.set(1);
    x.set(0);
    y.set(0);
    dismissY.set(0);
  }, [visible, scale, x, y, dismissY]);

  useEffect(() => {
    if (!screen) return;
    const fit = natural ? Math.min(screen.width / natural.width, screen.height / natural.height) : 1;
    bounds.set({
      screenWidth: screen.width,
      screenHeight: screen.height,
      contentWidth: natural ? natural.width * fit : screen.width,
      contentHeight: natural ? natural.height * fit : screen.height,
    });
  }, [screen, natural, bounds]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setScreen({ width, height });
  };
  // Some images report no size, which would make the bounds NaN; those fall back to the screen's size.
  const onLoad = ({ source }: ImageLoadEventData) => {
    if (source.width > 0 && source.height > 0) setNatural({ width: source.width, height: source.height });
  };

  // Moves the photo to a zoom level and offset, kept within its edges.
  function settle(toScale: number, toX: number, toY: number, animate: (to: number) => number) {
    'worklet';
    const b = bounds.get();
    scale.set(animate(toScale));
    x.set(animate(clamp(toX, limit(b.contentWidth, toScale, b.screenWidth))));
    y.set(animate(clamp(toY, limit(b.contentHeight, toScale, b.screenHeight))));
  }

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      pinched.set(true);
      dismissY.set(withSpring(0, SETTLE));
      const b = bounds.get();
      // The focal point relative to the screen's center, where the scale transform is anchored.
      start.set({
        scale: scale.get(),
        x: x.get(),
        y: y.get(),
        focalX: e.focalX - b.screenWidth / 2,
        focalY: e.focalY - b.screenHeight / 2,
      });
    })
    .onUpdate((e) => {
      const s = start.get();
      // A little give past the limits, which springs back on release.
      const next = Math.min(Math.max(s.scale * e.scale, 0.8), MAX_SCALE * 1.2);
      // Keep the point under the fingers in place as the photo grows.
      const ratio = next / s.scale;
      scale.set(next);
      x.set(s.focalX - (s.focalX - s.x) * ratio);
      y.set(s.focalY - (s.focalY - s.y) * ratio);
    })
    .onEnd(() => {
      settle(Math.min(Math.max(scale.get(), 1), MAX_SCALE), x.get(), y.get(), springTo);
    });

  // Zoomed in, a drag looks around the photo. Zoomed out, it swipes the viewer away.
  // A pinch usually starts with one finger moving before the other lands, which also starts this pan.
  // Once a pinch joins in, the pan stops swiping, so the viewer can't close in the middle of a zoom.
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onBegin(() => {
      pinched.set(false);
    })
    .onStart(() => {
      start.set({ ...start.get(), x: x.get(), y: y.get() });
    })
    .onUpdate((e) => {
      if (pinched.get()) return;
      if (scale.get() > 1) {
        const b = bounds.get();
        x.set(clamp(start.get().x + e.translationX, limit(b.contentWidth, scale.get(), b.screenWidth)));
        y.set(clamp(start.get().y + e.translationY, limit(b.contentHeight, scale.get(), b.screenHeight)));
      } else {
        dismissY.set(e.translationY);
      }
    })
    .onEnd((e, success) => {
      if (scale.get() > 1) return;
      const swiped = Math.abs(dismissY.get()) > DISMISS_DISTANCE || Math.abs(e.velocityY) > DISMISS_VELOCITY;
      if (success && !pinched.get() && swiped) {
        scheduleOnRN(onClose);
      } else {
        dismissY.set(withSpring(0, SETTLE));
      }
    });

  // Double tap zooms in on the tapped spot, or back out.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.get() > 1) {
        settle(1, 0, 0, timeTo);
        return;
      }
      const b = bounds.get();
      const focalX = e.x - b.screenWidth / 2;
      const focalY = e.y - b.screenHeight / 2;
      settle(DOUBLE_TAP_SCALE, focalX * (1 - DOUBLE_TAP_SCALE), focalY * (1 - DOUBLE_TAP_SCALE), timeTo);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() + dismissY.get() }, { scale: scale.get() }],
  }));
  // The backdrop fades as the photo is swiped away, showing the quest card underneath.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(dismissY.get()), [0, bounds.get().screenHeight / 2], [1, 0.3], Extrapolation.CLAMP),
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <StatusBar style="light" />
      {/* Modals open in their own window, so gestures inside need their own root. */}
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.root} onLayout={onLayout} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
          <GestureDetector gesture={gesture}>
            <Animated.View style={[styles.root, photoStyle]} accessible accessibilityRole="image" accessibilityLabel={label}>
              <Image
                source={{ uri: photo.url, cacheKey: photo.id }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                onLoad={onLoad}
              />
            </Animated.View>
          </GestureDetector>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            style={squish([styles.close, { top: insets.top + Spacing.two, right: insets.right + Spacing.three }])}>
            <ThemedText type="smallBold" style={styles.closeLabel}>
              Close
            </ThemedText>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// The animations settle() uses. They are named worklets, not inline arrows, because the React Compiler
// hoists inline arrows out of the component into plain functions that can't run on the UI thread.
function springTo(to: number) {
  'worklet';
  return withSpring(to, SETTLE);
}

function timeTo(to: number) {
  'worklet';
  return withTiming(to);
}

// How far the photo can move from center at a zoom level before its edge passes the screen's edge.
function limit(content: number, scale: number, screen: number) {
  'worklet';
  return Math.max(0, (content * scale - screen) / 2);
}

function clamp(value: number, bound: number) {
  'worklet';
  return Math.min(Math.max(value, -bound), bound);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: BACKDROP,
  },
  close: {
    position: 'absolute',
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: {
    color: ON_BACKDROP,
  },
});
