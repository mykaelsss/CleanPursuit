import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLocation, parseVolume, photoPoint, saveQuest } from '../src/lib/create-quest.ts';
import { isValidSchedule, scheduleDates, scheduleProblem } from '../src/components/create-quest/schedule-utils.ts';

const input = {
  photoFileId: 'photo', description: 'Bottles by the gate', location: { latitude: 40.7, longitude: -74 },
  placeName: 'Park gate', categories: ['plastic'], hazards: [],
};
const report = { id: 'report', ...input, questId: null, duplicateOf: null };
const quest = { id: 'quest', title: 'Clean the park gate', status: 'open', report };

function api(handler) {
  const calls = [];
  return { calls, request: async (path, options = {}) => {
    calls.push({ path, ...options });
    return handler(path, options);
  } };
}

test('location requires both valid coordinates, including zero and negative values', () => {
  assert.equal(parseLocation('', '-74'), null);
  assert.equal(parseLocation('40.7', ''), null);
  assert.equal(parseLocation('91', '0'), null);
  assert.equal(parseLocation('0', '-181'), null);
  assert.equal(parseLocation('NaN', '0'), null);
  assert.deepEqual(parseLocation('0', '-74'), { latitude: 0, longitude: -74 });
});

test('photo GPS reads Android signed degrees and iOS degrees with N/S and E/W refs', () => {
  assert.deepEqual(photoPoint({ exif: { GPSLatitude: 40.7265, GPSLongitude: -73.9815 } }), { latitude: 40.7265, longitude: -73.9815 });
  assert.deepEqual(photoPoint({ exif: { GPSLatitude: -40.7265, GPSLatitudeRef: 'S', GPSLongitude: -73.9815, GPSLongitudeRef: 'W' } }),
    { latitude: -40.7265, longitude: -73.9815 });
  assert.deepEqual(photoPoint({ exif: { GPSLatitude: 40.7265, GPSLatitudeRef: 'N', GPSLongitude: 73.9815, GPSLongitudeRef: 'W' } }),
    { latitude: 40.7265, longitude: -73.9815 });
  assert.equal(photoPoint({ exif: null }), null);
  assert.equal(photoPoint({ exif: { GPSLatitude: 40.7 } }), null);
  assert.equal(photoPoint({ exif: { GPSLatitude: 0, GPSLongitude: 0 } }), null);
  assert.equal(photoPoint({ exif: { GPSLatitude: 'abc', GPSLongitude: -74 } }), null);
});

test('volume accepts optional input, tight ranges and the small-pile allowance', () => {
  assert.equal(parseVolume('', ''), undefined);
  assert.deepEqual(parseVolume('100', '150'), { minGallons: 100, maxGallons: 150 });
  assert.deepEqual(parseVolume('1', '14'), { minGallons: 1, maxGallons: 14 });
  for (const [low, high] of [['100', '151'], ['10', '9'], ['0', '13'], ['1.5', '2'], ['1', ''], ['10000', '10001']]) {
    assert.equal(parseVolume(low, high), null, `${low}-${high}`);
  }
});

test('scheduling converts local noon/midnight to dates and rejects past or long events', () => {
  const date = new Date(2030, 0, 15);
  const schedule = { date, start: { hour: '12', minute: '00', meridiem: 'AM' },
    end: { hour: '12', minute: '00', meridiem: 'PM' } };
  const { start, end } = scheduleDates(schedule);
  assert.equal(start.getHours(), 0);
  assert.equal(end.getHours(), 12);
  assert.equal(isValidSchedule(schedule, start.getTime() - 1), true);
  assert.equal(isValidSchedule(schedule, start.getTime()), false);
  assert.equal(isValidSchedule({ ...schedule, end: { ...schedule.end, minute: '01' } }, 0), false);
  assert.equal(isValidSchedule({ ...schedule, start: { ...schedule.start, hour: '1.5' } }, 0), false);
  assert.equal(isValidSchedule({ ...schedule, end: schedule.start }, 0), false);
});

test('schedule problems explain past starts and long parties, leaving bad times to the time inputs', () => {
  const date = new Date(2030, 0, 15);
  const schedule = { date, start: { hour: '1', minute: '00', meridiem: 'AM' },
    end: { hour: '2', minute: '00', meridiem: 'PM' } };
  const { start } = scheduleDates(schedule);
  assert.equal(scheduleProblem(schedule, start.getTime() - 1), 'Parties can last at most 12 hours.');
  assert.equal(scheduleProblem({ ...schedule, end: { ...schedule.end, hour: '1' } }, start.getTime() - 1), null);
  assert.equal(scheduleProblem(schedule, start.getTime()), 'Pick a start time in the future.');
  assert.equal(scheduleProblem({ ...schedule, end: schedule.start }, 0), null);
});

test('creation sends confirmed report fields and creates its quest without organizing a party', async () => {
  const server = api((path, options) => {
    if (path === '/files/photo/report') return null;
    if (path === '/reports') { assert.deepEqual(options.body, input); return report; }
    if (path === '/reports/report') return report;
    if (path === '/reports/report/quest') { assert.deepEqual(options.body, { title: quest.title }); return quest; }
    throw new Error(`Unexpected request ${path}`);
  });
  const progress = {};
  assert.equal(await saveQuest(server.request, input, `  ${quest.title}  `, progress, () => {}), quest);
  assert.equal(progress.report, report);
  assert.equal(progress.quest, quest);
  assert.equal(server.calls.some((call) => call.path.includes('/events')), false);
});

test('a failed quest request resumes from the saved report and recovers a lost quest response', async () => {
  let questSaved = false;
  const server = api((path) => {
    if (path === '/files/photo/report') return null;
    if (path === '/reports') return report;
    if (path === '/reports/report') return { ...report, questId: questSaved ? quest.id : null };
    if (path === '/reports/report/quest') { questSaved = true; throw new Error('Connection lost'); }
    if (path === '/quests/quest') return quest;
    throw new Error(`Unexpected request ${path}`);
  });
  const progress = {};
  await assert.rejects(saveQuest(server.request, input, quest.title, progress, () => {}), /Connection lost/);
  assert.equal(progress.report, report);
  assert.equal(await saveQuest(server.request, input, quest.title, progress, () => {}), quest);
  assert.equal(server.calls.filter((call) => call.path === '/reports' && call.method === 'POST').length, 1);
  assert.equal(server.calls.filter((call) => call.path === '/reports/report/quest').length, 1);
});

test('a lost report response is recovered by photo without submitting a second report', async () => {
  let reportSaved = false;
  const server = api((path) => {
    if (path === '/files/photo/report') return reportSaved ? { ...report, questId: quest.id } : null;
    if (path === '/reports') { reportSaved = true; throw new Error('Connection lost'); }
    if (path === '/reports/report') return { ...report, questId: quest.id };
    if (path === '/quests/quest') return quest;
    throw new Error(`Unexpected request ${path}`);
  });
  const progress = {};
  await assert.rejects(saveQuest(server.request, input, quest.title, progress, () => {}));
  assert.equal(await saveQuest(server.request, input, quest.title, progress, () => {}), quest);
  assert.equal(server.calls.filter((call) => call.path === '/reports' && call.method === 'POST').length, 1);
});

test('duplicates reuse the original quest and retain the new sighting', async () => {
  const duplicate = { ...report, id: 'duplicate', duplicateOf: { reportId: report.id, questId: quest.id } };
  const server = api((path) => {
    if (path === '/files/photo/report') return null;
    if (path === '/reports') return duplicate;
    if (path === '/reports/report') return { ...report, questId: quest.id };
    if (path === '/quests/quest') return quest;
    throw new Error(`Unexpected request ${path}`);
  });
  const progress = {};
  assert.equal(await saveQuest(server.request, input, quest.title, progress, () => {}), quest);
  assert.equal(progress.report, duplicate);
  assert.equal(server.calls.some((call) => call.method === 'POST' && call.path.endsWith('/quest')), false);
});

test('a duplicate whose original has no quest creates the quest on the original report', async () => {
  const duplicate = { ...report, id: 'duplicate', duplicateOf: { reportId: report.id, questId: null } };
  const server = api((path) => {
    if (path === '/files/photo/report') return null;
    if (path === '/reports') return duplicate;
    if (path === '/reports/report') return report;
    if (path === '/reports/report/quest') return quest;
    throw new Error(`Unexpected request ${path}`);
  });
  assert.equal(await saveQuest(server.request, input, quest.title, {}, () => {}), quest);
});

test('a concurrent creator winning the quest race is recovered without an error', async () => {
  let won = false;
  const server = api((path) => {
    if (path === '/files/photo/report') return report;
    if (path === '/reports/report') return { ...report, questId: won ? quest.id : null };
    if (path === '/reports/report/quest') { won = true; throw Object.assign(new Error('Already created'), { code: 'QUEST_EXISTS' }); }
    if (path === '/quests/quest') return quest;
    throw new Error(`Unexpected request ${path}`);
  });
  assert.equal(await saveQuest(server.request, input, quest.title, {}, () => {}), quest);
});
