import { StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import CalendarPicker from '@/components/create-quest/calendar-picker';
import QuestIcon from '@/components/create-quest/quest-icon';
import type { ScheduleValue } from '@/components/create-quest/schedule-utils';
import StepHeading from '@/components/create-quest/step-heading';
import TimeRangeInput from '@/components/create-quest/time-range-input';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type ScheduleStepProps = {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
};

export default function ScheduleStep({ value, onChange }: ScheduleStepProps) {
  return (
    <AppCard>
      <StepHeading number={4} title="SCHEDULE THE PARTY" />
      <ThemedText type="small" themeColor="textSecondary">
        Pick a future start and a later end on the same date, up to 12 hours apart. Times use the time zone on your device.
      </ThemedText>
      <ScheduleFields value={value} onChange={onChange} />
    </AppCard>
  );
}

// The date and time pickers on their own, for scheduling a party outside the create flow.
export function ScheduleFields({ value, onChange }: ScheduleStepProps) {
  const theme = useTheme();

  return (
    <View style={styles.fieldGroup}>
      <View style={styles.label}>
        <QuestIcon name="calendar" color={theme.tint} size={20} />
        <ThemedText type="smallBold">Choose a date</ThemedText>
      </View>

      <View style={[styles.calendar, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <CalendarPicker
          schedule={value}
          onDateChange={(date) => onChange({ ...value, date })}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <TimeRangeInput
          start={value.start}
          end={value.end}
          onStartChange={(start) => onChange({ ...value, start })}
          onEndChange={(end) => onChange({ ...value, end })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    gap: 9,
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calendar: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  divider: {
    height: 1,
    marginHorizontal: -12,
  },
});
