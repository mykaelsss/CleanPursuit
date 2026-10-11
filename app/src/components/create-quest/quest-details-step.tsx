import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import AppCard from '@/components/app-card';
import { QUEST_TAGS } from '@/components/create-quest/constants';
import { FormField } from '@/components/create-quest/form-controls';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { ReportTags } from '@/lib/api';
import { parseVolume } from '@/lib/create-quest';

type QuestDetailsStepProps = {
  title: string;
  description: string;
  volumeLow: string;
  volumeHigh: string;
  tags: ReportTags;
  selectedTags: string[];
  selectedSafetyFlags: string[];
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onVolumeChange: (low: string, high: string) => void;
  onTagPress: (code: string) => void;
  onSafetyFlagPress: (code: string) => void;
};

export default function QuestDetailsStep({
  title,
  description,
  volumeLow,
  volumeHigh,
  tags,
  selectedTags,
  selectedSafetyFlags,
  onTitleChange,
  onDescriptionChange,
  onVolumeChange,
  onTagPress,
  onSafetyFlagPress,
}: QuestDetailsStepProps) {
  const theme = useTheme();

  return (
    <AppCard>
      <StepHeading number={2} title="NAME THE MISSION" />

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <ThemedText type="smallBold">Quest title</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {title.length}/80
          </ThemedText>
        </View>
        <TextInput
          accessibilityLabel="Quest title"
          maxLength={80}
          onChangeText={onTitleChange}
          placeholder="Example: Restore Riverside Trail"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          style={[
            styles.textInput,
            { backgroundColor: theme.background, borderColor: theme.border, color: theme.text },
          ]}
          value={title}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Make it specific, positive, and easy to spot on the quest board.
        </ThemedText>
      </View>

      <FormField label="Describe the litter and the spot" value={description} multiline maxLength={2000}
        placeholder="What needs cleaning, and where should volunteers look?" onChangeText={onDescriptionChange} />

      <View style={styles.fieldGroup}>
        <FieldLabel title="What will your party find?" helper="Select all" />
        <View style={styles.tags}>
          {tags.categories.map((tag) => {
            const selected = selectedTags.includes(tag.code);
            return (
              <TagButton
                key={tag.code}
                icon={QUEST_TAGS.find((item) => item.code === tag.code)?.icon ?? '♻️'}
                label={tag.label}
                selected={selected}
                onPress={() => onTagPress(tag.code)}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel title="Safety flags" helper="Select if present" />
        <ThemedText type="small" themeColor="textSecondary">
          Flag items that need drop-off or sanitation escalation guidance.
        </ThemedText>
        <View style={styles.tags}>
          {tags.hazards.map((flag) => (
            <TagButton
              safety
              key={flag.code}
              icon="⚠️"
              label={flag.label}
              selected={selectedSafetyFlags.includes(flag.code)}
              onPress={() => onSafetyFlagPress(flag.code)}
            />
          ))}
        </View>
        {tags.hazards.filter((flag) => selectedSafetyFlags.includes(flag.code)).map((flag) => (
          <ThemedText key={flag.code} type="small" themeColor="textSecondary">{flag.warning}</ThemedText>
        ))}
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel title="Trash amount (US gallons)" helper="Optional" />
        <View style={styles.labelRow}>
          <View style={{ flex: 1 }}><FormField label="Low estimate" value={volumeLow} keyboardType="number-pad"
            onChangeText={(low) => onVolumeChange(low, volumeHigh)} /></View>
          <View style={{ flex: 1 }}><FormField label="High estimate" value={volumeHigh} keyboardType="number-pad"
            onChangeText={(high) => onVolumeChange(volumeLow, high)} /></View>
        </View>
        <VolumeSummary low={volumeLow} high={volumeHigh} />
      </View>
    </AppCard>
  );
}

function VolumeSummary({ low, high }: { low: string; high: string }) {
  const range = parseVolume(low, high);
  if (range === null) return <ThemedText type="small" themeColor="error">
    Use whole gallons from 1 to 10,000. The high estimate must be at least the low estimate and no more than 1.5 times it or 13 gallons above it.
  </ThemedText>;
  if (!range) return <ThemedText type="small" themeColor="textSecondary">Leave both blank if you are unsure. Flag bulky items separately.</ThemedText>;
  return <View style={styles.fieldGroup}>
    {[{ label: 'Kitchen', gallons: 13 }, { label: 'Large', gallons: 33 }, { label: 'Contractor', gallons: 42 }].map((bag) => (
      <ThemedText key={bag.gallons} type="small" themeColor="textSecondary">
        {bag.label} ({bag.gallons} gal): {Math.ceil(range.minGallons / bag.gallons)}-{Math.ceil(range.maxGallons / bag.gallons)} bags
      </ThemedText>
    ))}
  </View>;
}

function FieldLabel({ title, helper }: { title: string; helper: string }) {
  return (
    <View style={styles.labelRow}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {helper}
      </ThemedText>
    </View>
  );
}

type TagButtonProps = {
  icon: string;
  label: string;
  selected: boolean;
  safety?: boolean;
  onPress: () => void;
};

function TagButton({ icon, label, selected, safety = false, onPress }: TagButtonProps) {
  const theme = useTheme();
  const backgroundColor = selected ? (safety ? theme.reward : theme.sage) : theme.background;
  const borderColor = selected ? (safety ? theme.error : theme.tint) : theme.border;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tag,
        safety && styles.safetyTag,
        { backgroundColor, borderColor },
        pressed && styles.pressed,
      ]}>
      <ThemedText style={styles.tagEmoji}>{icon}</ThemedText>
      <ThemedText type="smallBold" style={{ color: selected && !safety ? theme.sageText : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    gap: 9,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  textInput: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  safetyTag: {
    minWidth: 130,
    justifyContent: 'center',
  },
  tagEmoji: {
    fontSize: 15,
  },
  pressed: {
    opacity: 0.72,
  },
});
