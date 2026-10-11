import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import QuestIcon from '@/components/create-quest/quest-icon';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type PhotoStepProps = {
  photo: ImagePicker.ImagePickerAsset | null;
  onPhotoChange: (photo: ImagePicker.ImagePickerAsset | null) => void;
};

export default function PhotoStep({ photo, onPhotoChange }: PhotoStepProps) {
  const theme = useTheme();

  const choosePhoto = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera access needed', 'Allow camera access to photograph the cleanup spot.');
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled) onPhotoChange(result.assets[0] ?? null);
    } catch {
      Alert.alert('Photo unavailable', 'We could not open your camera or photo library. Please try again.');
    }
  };

  return (
    <AppCard>
      <StepHeading number={1} title="SHOW THE SPOT" />

      {photo ? (
        <View style={styles.preview}>
          <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" transition={180} />
          <Pressable
            accessibilityLabel="Remove selected photo"
            accessibilityRole="button"
            onPress={() => onPhotoChange(null)}
            style={({ pressed }) => [
              styles.removeButton,
              { backgroundColor: theme.text },
              pressed && styles.pressed,
            ]}>
            <QuestIcon name="close" color={theme.backgroundElement} size={18} />
          </Pressable>
          <View style={[styles.readyBadge, { backgroundColor: theme.primary }]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
              PHOTO SELECTED
            </ThemedText>
          </View>
        </View>
      ) : (
        <View style={[styles.empty, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.highlight }]}>
            <QuestIcon name="camera" color={theme.text} size={32} />
          </View>
          <View style={styles.emptyCopy}>
            <ThemedText type="smallBold">Add a clear before photo</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              Help volunteers see the area and what they are signing up for.
            </ThemedText>
          </View>
        </View>
      )}

      <View style={styles.buttonRow}>
        <PhotoButton label="Take photo" icon="camera" primary onPress={() => choosePhoto('camera')} />
        <PhotoButton label="Upload" icon="upload" onPress={() => choosePhoto('library')} />
      </View>
    </AppCard>
  );
}

type PhotoButtonProps = {
  label: string;
  icon: 'camera' | 'upload';
  primary?: boolean;
  onPress: () => void;
};

function PhotoButton({ label, icon, primary = false, onPress }: PhotoButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.photoButton,
        primary
          ? { backgroundColor: theme.tint, borderColor: theme.tint }
          : { borderColor: theme.border },
        pressed && styles.pressed,
      ]}>
      <QuestIcon name={icon} color={primary ? theme.onTint : theme.text} size={20} />
      <ThemedText type="smallBold" style={{ color: primary ? theme.onTint : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 220,
    borderRadius: 14,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  empty: {
    minHeight: 190,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCopy: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 270,
  },
  centerText: {
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: {
    opacity: 0.72,
  },
});
