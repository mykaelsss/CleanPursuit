import type { ImagePickerAsset } from 'expo-image-picker';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import {
  SAFETY_FLAGS,
  type SafetyFlagCode,
} from '@/components/create-quest/constants';
import PartySizeStep from '@/components/create-quest/party-size-step';
import PhotoStep from '@/components/create-quest/photo-step';
import QuestDetailsStep from '@/components/create-quest/quest-details-step';
import {
  CreateQuestButton,
  CreateQuestHero,
  QuestReadiness,
  QuestReward,
} from '@/components/create-quest/quest-status';
import SafetyWarningModal from '@/components/create-quest/safety-warning-modal';
import ScheduleStep from '@/components/create-quest/schedule-step';
import {
  createInitialSchedule,
  formatTime,
  isValidSchedule,
} from '@/components/create-quest/schedule-utils';
import ScreenLayout from '@/components/screen-layout';
import { ThemedText } from '@/components/themed-text';

export default function CreateQuestScreen() {
  const [photo, setPhoto] = useState<ImagePickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedSafetyFlags, setSelectedSafetyFlags] = useState<SafetyFlagCode[]>([]);
  const [pendingSafetyFlag, setPendingSafetyFlag] = useState<SafetyFlagCode | null>(null);
  const [schedule, setSchedule] = useState(createInitialSchedule);
  const [partySize, setPartySize] = useState(4);

  const completedSteps = [
    photo !== null,
    title.trim().length >= 3,
    selectedTags.length > 0,
    isValidSchedule(schedule),
  ].filter(Boolean).length;
  const ready = completedSteps === 4;
  const pendingSafetyDetails = SAFETY_FLAGS.find((flag) => flag.code === pendingSafetyFlag);

  const toggleTag = (code: string) => {
    setSelectedTags((current) =>
      current.includes(code) ? current.filter((tag) => tag !== code) : [...current, code],
    );
  };

  const toggleSafetyFlag = (code: SafetyFlagCode) => {
    if (selectedSafetyFlags.includes(code)) {
      setSelectedSafetyFlags((current) => current.filter((flag) => flag !== code));
    } else {
      setPendingSafetyFlag(code);
    }
  };

  const confirmSafetyFlag = () => {
    if (pendingSafetyFlag) {
      setSelectedSafetyFlags((current) => [...new Set([...current, pendingSafetyFlag])]);
    }
    setPendingSafetyFlag(null);
  };

  const createQuest = () => {
    if (!ready) {
      Alert.alert('Almost there', 'Add a photo, a title, and at least one tag to create your quest.');
      return;
    }

    const date = schedule.date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    Alert.alert(
      'Quest ready!',
      `${title.trim()} is set for ${date} from ${formatTime(schedule.start)} to ${formatTime(schedule.end)} with a recommended party of ${partySize}.`,
    );
  };

  return (
    <>
      <ScreenLayout
        title="Create a quest"
        subtitle="Rally your neighborhood around a spot that needs some care."
        headerContent={<CreateQuestHero />}>
        <QuestReadiness completedSteps={completedSteps} />
        <PhotoStep photo={photo} onPhotoChange={setPhoto} />
        <QuestDetailsStep
          title={title}
          selectedTags={selectedTags}
          selectedSafetyFlags={selectedSafetyFlags}
          onTitleChange={setTitle}
          onTagPress={toggleTag}
          onSafetyFlagPress={toggleSafetyFlag}
        />
        <ScheduleStep value={schedule} onChange={setSchedule} />
        <PartySizeStep value={partySize} onChange={setPartySize} />
        <QuestReward />
        <CreateQuestButton ready={ready} onPress={createQuest} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
          You can edit the details before your party begins.
        </ThemedText>
      </ScreenLayout>

      <SafetyWarningModal
        flag={pendingSafetyDetails}
        onCancel={() => setPendingSafetyFlag(null)}
        onConfirm={confirmSafetyFlag}
      />
    </>
  );
}

const styles = StyleSheet.create({
  footerNote: {
    textAlign: 'center',
  },
});
