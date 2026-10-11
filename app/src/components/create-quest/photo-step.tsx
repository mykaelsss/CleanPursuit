import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import { FormButton } from '@/components/create-quest/form-controls';
import QuestIcon from '@/components/create-quest/quest-icon';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type PhotoStatus = 'idle' | 'uploading' | 'analyzing' | 'ready' | 'error';
export type PhotoSource = 'camera' | 'library';

type PhotoStepProps = {
  photo: ImagePicker.ImagePickerAsset | null;
  status: PhotoStatus;
  message: string | null;
  // The source is set for a new photo, so the screen can tell if the reporter is at the spot.
  onPhotoChange: (photo: ImagePicker.ImagePickerAsset | null, source?: PhotoSource) => void;
  onRetry: () => void;
  onSkipAnalysis: () => void;
};

const BADGES: Record<PhotoStatus, string> = {
  idle: 'Photo selected',
  uploading: 'Uploading...',
  analyzing: 'Checking the photo...',
  ready: 'Uploaded',
  error: 'Upload failed',
};

export default function PhotoStep({ photo, status, message, onPhotoChange, onRetry, onSkipAnalysis }: PhotoStepProps) {
  const theme = useTheme();
  const working = status === 'uploading' || status === 'analyzing';
  const badgeColor = status === 'error' ? theme.error : status === 'ready' ? theme.tint : theme.primary;
  const badgeText = status === 'error' || status === 'ready' ? theme.onTint : theme.onPrimary;

  const choosePhoto = async (source: PhotoSource) => {
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
        // For the GPS tags, which prefill the spot. The upload is re-encoded without EXIF.
        exif: true,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled) onPhotoChange(result.assets[0] ?? null, source);
    } catch {
      Alert.alert('Photo unavailable', 'We could not open your camera or photo library. Please try again.');
    }
  };

  return (
    <AppCard>
      <StepHeading number={1} title="Show the spot" done={status === 'ready'} />

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
          <View style={[styles.readyBadge, { backgroundColor: badgeColor }]}>
            {working ? <ActivityIndicator size="small" color={badgeText} /> : null}
            {status === 'ready' ? <QuestIcon name="check" color={badgeText} size={16} /> : null}
            <ThemedText type="smallBold" style={{ color: badgeText }}>
              {BADGES[status]}
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
        <PhotoButton label={photo ? 'Retake' : 'Take photo'} icon="camera" primary={!photo}
          onPress={() => choosePhoto('camera')} />
        <PhotoButton label={photo ? 'Choose another' : 'Choose photo'} icon="upload"
          onPress={() => choosePhoto('library')} />
      </View>

      {message ? (
        <ThemedText type="small" themeColor={status === 'error' ? 'error' : 'textSecondary'}
          accessibilityLiveRegion="polite">
          {message}
        </ThemedText>
      ) : null}
      {status === 'error' && photo ? <FormButton label="Retry photo upload" onPress={onRetry} /> : null}
      {status === 'analyzing' ? <FormButton label="Continue without AI suggestions" onPress={onSkipAnalysis} /> : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
