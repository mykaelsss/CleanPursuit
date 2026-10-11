import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import AppCard from '@/components/app-card';
import { QUEST_TAGS, SAFETY_FLAGS, type SafetyFlagCode } from '@/components/create-quest/constants';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type QuestDetailsStepProps = {
  title: string;
  selectedTags: string[];
  selectedSafetyFlags: SafetyFlagCode[];
  onTitleChange: (title: string) => void;
  onTagPress: (code: string) => void;
  onSafetyFlagPress: (code: SafetyFlagCode) => void;
};

export default function QuestDetailsStep({
  title,
  selectedTags,
  selectedSafetyFlags,
  onTitleChange,
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

      <View style={styles.fieldGroup}>
        <FieldLabel title="What will your party find?" helper="Select all" />
        <View style={styles.tags}>
          {QUEST_TAGS.map((tag) => {
            const selected = selectedTags.includes(tag.code);
            return (
              <TagButton
                key={tag.code}
                icon={tag.icon}
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
          {SAFETY_FLAGS.map((flag) => (
            <TagButton
              safety
              key={flag.code}
              icon={flag.icon}
              label={flag.label}
              selected={selectedSafetyFlags.includes(flag.code)}
              onPress={() => onSafetyFlagPress(flag.code)}
            />
          ))}
        </View>
      </View>
    </AppCard>
  );
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
