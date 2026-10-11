import { StyleSheet, Switch, View } from 'react-native';

import AppCard from '@/components/app-card';
import CalendarPicker from '@/components/create-quest/calendar-picker';
import QuestIcon from '@/components/create-quest/quest-icon';
import { scheduleProblem, type ScheduleValue } from '@/components/create-quest/schedule-utils';
import StepHeading from '@/components/create-quest/step-heading';
import TimeRangeInput from '@/components/create-quest/time-range-input';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type ScheduleStepProps = {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
};

// Scheduling the first party is optional, so the step starts with a switch.
export default function ScheduleStep({ enabled, onEnabledChange, disabled, done, value, onChange }: ScheduleStepProps & {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  disabled: boolean;
  done: boolean;
}) {
  const problem = enabled ? scheduleProblem(value) : null;
  return (
    <AppCard>
      <StepHeading number={4} title="Schedule a party" done={done} rightContent={
        <Switch accessibilityLabel="Schedule a party" value={enabled} onValueChange={onEnabledChange} disabled={disabled} />
      } />
      <ThemedText type="small" themeColor="textSecondary">{enabled
        ? 'You will lead the party and be its first attendee. Only the leader can end it. Pick a start and end on the same day, up to 12 hours apart, in your device\'s time zone.'
        : 'Optional. The quest goes on the map without a party, and anyone can schedule one later.'}</ThemedText>
      {enabled ? <ScheduleFields value={value} onChange={onChange} /> : null}
      {problem ? <ThemedText type="small" themeColor="error">{problem}</ThemedText> : null}
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
