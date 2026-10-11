import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import QuestIcon from '@/components/create-quest/quest-icon';
import {
  isEndLater,
  isValidTime,
  type TimeValue,
} from '@/components/create-quest/schedule-utils';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type TimeRangeInputProps = {
  start: TimeValue;
  end: TimeValue;
  onStartChange: (value: TimeValue) => void;
  onEndChange: (value: TimeValue) => void;
};

export default function TimeRangeInput({
  start,
  end,
  onStartChange,
  onEndChange,
}: TimeRangeInputProps) {
  return (
    <View style={styles.range}>
      <TimeInputRow label="Start time" value={start} onChange={onStartChange} />
      <TimeInputRow label="End time" value={end} onChange={onEndChange} />
      {isValidTime(start) && isValidTime(end) && !isEndLater(start, end) ? (
        <ThemedText type="small" themeColor="error">
          End time must be later than start time.
        </ThemedText>
      ) : null}
    </View>
  );
}

function TimeInputRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TimeValue;
  onChange: (value: TimeValue) => void;
}) {
  const theme = useTheme();

  const setPart = (part: 'hour' | 'minute', text: string) => {
    onChange({ ...value, [part]: text.replace(/\D/g, '').slice(0, 2) });
  };

  const normalize = (part: 'hour' | 'minute') => {
    if (part === 'hour') {
      const hour = Number(value.hour);
      onChange({ ...value, hour: String(hour >= 1 && hour <= 12 ? hour : 10) });
      return;
    }
    const minute = Math.min(Math.max(Number(value.minute) || 0, 0), 59);
    onChange({ ...value, minute: String(minute).padStart(2, '0') });
  };

  return (
    <View style={styles.entry}>
      <View style={styles.label}>
        <QuestIcon name="clock" color={theme.tint} size={20} />
        <ThemedText type="smallBold">{label}</ThemedText>
      </View>
      <View style={styles.controls}>
        <View style={styles.clockInputs}>
          <TimeTextInput
            label={`${label} hour`}
            placeholder={label === 'Start time' ? '10' : '12'}
            value={value.hour}
            onBlur={() => normalize('hour')}
            onChangeText={(text) => setPart('hour', text)}
          />
          <ThemedText type="subtitle" style={styles.colon}>
            :
          </ThemedText>
          <TimeTextInput
            label={`${label} minute`}
            placeholder="00"
            value={value.minute}
            onBlur={() => normalize('minute')}
            onChangeText={(text) => setPart('minute', text)}
          />
        </View>
        <View
          style={[
            styles.meridiemControl,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          {(['AM', 'PM'] as const).map((period) => {
            const selected = period === value.meridiem;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={period}
                onPress={() => onChange({ ...value, meridiem: period })}
                style={({ pressed }) => [
                  styles.meridiemButton,
                  selected && { backgroundColor: theme.tint },
                  pressed && styles.pressed,
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: selected ? theme.onTint : theme.textSecondary }}>
                  {period}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
      {!isValidTime(value) ? (
        <ThemedText type="small" themeColor="error">
          Enter an hour from 1 to 12 and minutes from 00 to 59.
        </ThemedText>
      ) : null}
    </View>
  );
}

function TimeTextInput({
  label,
  placeholder,
  value,
  onBlur,
  onChangeText,
}: {
  label: string;
  placeholder: string;
  value: string;
  onBlur: () => void;
  onChangeText: (value: string) => void;
}) {
  const theme = useTheme();

  return (
    <TextInput
      accessibilityLabel={label}
      keyboardType="number-pad"
      maxLength={2}
      onBlur={onBlur}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      selectTextOnFocus
      style={[
        styles.timeInput,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
      ]}
      value={value}
    />
  );
}

const styles = StyleSheet.create({
  range: {
    gap: 16,
    paddingTop: 2,
  },
  entry: {
    gap: 9,
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  clockInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timeInput: {
    width: 58,
    height: 52,
    borderWidth: 1,
    borderRadius: 13,
    textAlign: 'center',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
  },
  colon: {
    lineHeight: 36,
  },
  meridiemControl: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 13,
    padding: 3,
  },
  meridiemButton: {
    minWidth: 48,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
