import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import QuestIcon from '@/components/create-quest/quest-icon';
import { formatTime, type ScheduleValue } from '@/components/create-quest/schedule-utils';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type CalendarPickerProps = {
  schedule: ScheduleValue;
  onDateChange: (date: Date) => void;
};

export default function CalendarPicker({ schedule, onDateChange }: CalendarPickerProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    new Date(schedule.date.getFullYear(), schedule.date.getMonth(), 1),
  );

  const days = useMemo(() => buildCalendarDays(visibleMonth, today), [today, visibleMonth]);
  const canGoBack = monthIndex(visibleMonth) > monthIndex(today);
  const monthLabel = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      <View style={styles.header}>
        <MonthButton
          disabled={!canGoBack}
          icon="chevronLeft"
          label="Previous month"
          onPress={() => changeMonth(-1)}
        />
        <View style={styles.monthTitle}>
          <ThemedText type="smallBold">{monthLabel}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.selectedSchedule}>
            {schedule.date.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}{' '}
            {formatTime(schedule.start)} - {formatTime(schedule.end)}
          </ThemedText>
        </View>
        <MonthButton
          icon="chevronRight"
          label="Next month"
          onPress={() => changeMonth(1)}
        />
      </View>

      <View style={styles.weekdayRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <View key={`${day}-${index}`} style={styles.weekdayCell}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.weekdayText}>
              {day}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day) => (
          <CalendarDay
            key={day.key}
            date={day.date}
            disabled={day.disabled}
            inMonth={day.inMonth}
            selected={sameDay(day.date, schedule.date)}
            today={sameDay(day.date, today)}
            onPress={() => onDateChange(day.date)}
          />
        ))}
      </View>
    </>
  );

  function changeMonth(amount: number) {
    setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + amount, 1));
  }
}

function MonthButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: 'chevronLeft' | 'chevronRight';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.monthButton,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <QuestIcon name={icon} color={theme.text} size={19} />
    </Pressable>
  );
}

function CalendarDay({
  date,
  disabled,
  inMonth,
  selected,
  today,
  onPress,
}: {
  date: Date;
  disabled: boolean;
  inMonth: boolean;
  selected: boolean;
  today: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.daySlot}>
      {inMonth ? (
        <Pressable
          accessibilityLabel={date.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
          accessibilityRole="radio"
          accessibilityState={{ disabled, selected }}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [
            styles.day,
            today && !selected && { borderColor: theme.accent, borderWidth: 1 },
            selected && { backgroundColor: theme.tint },
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <ThemedText
            type="smallBold"
            style={{ color: selected ? theme.onTint : disabled ? theme.textSecondary : theme.text }}>
            {date.getDate()}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function buildCalendarDays(visibleMonth: Date, today: Date) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDayOffset = new Date(year, month, 1).getDay();

  return Array.from({ length: 42 }, (_, index) => {
    const date = startOfDay(new Date(year, month, index - firstDayOffset + 1));
    return {
      date,
      inMonth: date.getMonth() === month,
      disabled: date < today,
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    };
  });
}

function startOfDay(date: Date) {
  date.setHours(0, 0, 0, 0);
  return date;
}

function monthIndex(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  monthButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  selectedSchedule: {
    textAlign: 'center',
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayCell: {
    width: '14.2857%',
    alignItems: 'center',
    paddingVertical: 3,
  },
  weekdayText: {
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  daySlot: {
    width: '14.2857%',
    padding: 2,
  },
  day: {
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.72,
  },
});
