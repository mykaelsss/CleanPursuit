export type Meridiem = 'AM' | 'PM';

export type TimeValue = {
  hour: string;
  minute: string;
  meridiem: Meridiem;
};

export type ScheduleValue = {
  date: Date;
  start: TimeValue;
  end: TimeValue;
};

export function createInitialSchedule(): ScheduleValue {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return {
    date,
    start: { hour: '10', minute: '00', meridiem: 'AM' },
    end: { hour: '12', minute: '00', meridiem: 'PM' },
  };
}

export function formatTime(time: TimeValue) {
  return `${time.hour || '--'}:${time.minute ? time.minute.padStart(2, '0') : '--'} ${time.meridiem}`;
}

export function isValidTime(time: TimeValue) {
  const hour = Number(time.hour);
  const minute = Number(time.minute);
  return (
    time.hour.length > 0 &&
    time.minute.length > 0 &&
    hour >= 1 &&
    hour <= 12 &&
    minute >= 0 &&
    minute <= 59 &&
    Number.isInteger(hour) &&
    Number.isInteger(minute)
  );
}

export function isEndLater(start: TimeValue, end: TimeValue) {
  return isValidTime(start) && isValidTime(end) && timeInMinutes(end) > timeInMinutes(start);
}

export function scheduleDates(schedule: ScheduleValue) {
  const start = new Date(schedule.date);
  const end = new Date(schedule.date);
  start.setHours(0, timeInMinutes(schedule.start), 0, 0);
  end.setHours(0, timeInMinutes(schedule.end), 0, 0);
  return { start, end };
}

export function isValidSchedule(schedule: ScheduleValue, now = Date.now()) {
  const { start, end } = scheduleDates(schedule);
  return isEndLater(schedule.start, schedule.end) && start.getTime() > now &&
    end.getTime() - start.getTime() <= 12 * 60 * 60 * 1000;
}

// Why a schedule with valid times is rejected. TimeRangeInput already explains invalid or reversed times.
export function scheduleProblem(schedule: ScheduleValue, now = Date.now()) {
  if (!isEndLater(schedule.start, schedule.end)) return null;
  const { start, end } = scheduleDates(schedule);
  if (start.getTime() <= now) return 'Pick a start time in the future.';
  if (end.getTime() - start.getTime() > 12 * 60 * 60 * 1000) return 'Parties can last at most 12 hours.';
  return null;
}

function timeInMinutes(time: TimeValue) {
  const hour24 = (Number(time.hour) % 12) + (time.meridiem === 'PM' ? 12 : 0);
  return hour24 * 60 + Number(time.minute);
}
