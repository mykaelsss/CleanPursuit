import type { Attendee, DifficultyTier, EventDetail, NearbyEvent } from '@/lib/api';

// Placeholder events around NYC, shown in development when the API has no real events, so the
// events screen's layout can be seen and tried. They never reach the API: joining one only
// changes local state. Photos are empty, so the screen draws a placeholder box.

export type SampleEvent = NearbyEvent & Pick<EventDetail, 'attendees'>;

export function isSampleEvent(id: string): boolean {
  return id.startsWith('sample-');
}

interface Me {
  id: string;
  username: string;
}

// Hours from now, so the samples always look upcoming.
function at(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

function person(username: string): Attendee['user'] {
  return { id: `sample-user-${username}`, username };
}

export function sampleEvents(from: { latitude: number; longitude: number }, me: Me): SampleEvent[] {
  const samples: {
    title: string;
    description: string;
    location: { latitude: number; longitude: number };
    tier: DifficultyTier;
    start: number;
    hours: number;
    maxXp: number;
    organizer: Attendee['user'];
    others: string[];
    joined?: boolean;
  }[] = [
    {
      title: 'Hudson River shoreline sweep',
      description:
        'Plastic bottles, bags and food wrappers have washed up along the rocks north of Pier 84. Gloves and bags provided.',
      location: { latitude: 40.7637, longitude: -73.999 },
      tier: 'easy',
      start: 20,
      hours: 2,
      maxXp: 200,
      organizer: person('riverkeeper_ana'),
      others: ['jmorales', 'greenstreets', 'tobi_cleans'],
    },
    {
      title: 'Tompkins Square litter pickup',
      description: 'Litter around the dog run and the benches on the Avenue A side after a busy weekend.',
      location: { latitude: 40.7265, longitude: -73.9815 },
      tier: 'medium',
      start: 44,
      hours: 2.5,
      maxXp: 375,
      organizer: person('east_village_eli'),
      others: ['sam_k', 'priya_p'],
    },
    {
      title: 'McCarren Park bottle cleanup',
      description:
        'Lots of broken bottles along the fence line by the track. We will bag everything and leave it at the park drop-off point.',
      location: { latitude: 40.7206, longitude: -73.9517 },
      tier: 'hard',
      start: 68,
      hours: 3,
      maxXp: 600,
      organizer: { id: me.id, username: me.username },
      others: ['bk_dana', 'wburg_walks', 'lee_h'],
    },
    {
      title: 'Flushing Meadows lakeside cleanup',
      description: 'Cups, cans and takeout containers along the path around Meadow Lake.',
      location: { latitude: 40.74, longitude: -73.8407 },
      tier: 'easy',
      start: 30,
      hours: 1.5,
      maxXp: 150,
      organizer: person('queens_qiu'),
      others: ['mateo_r'],
      joined: true,
    },
    {
      title: 'Bronx River bank cleanup',
      description:
        'Tires, a shopping cart and bulky debris snagged on the river bank. Needles were seen near the outfall and have been reported to 311 for removal; this cleanup covers the rest of the bank.',
      location: { latitude: 40.8406, longitude: -73.874 },
      tier: 'legendary',
      start: 92,
      hours: 4,
      maxXp: 900,
      organizer: person('bronx_river_ray'),
      others: ['kayla_b', 'dev_o', 'nina_w', 'paolo_g', 'hc_volunteers'],
    },
    {
      title: 'Coney Island beach sweep',
      description: 'Beach sweep between the pier and the aquarium. Meet at the boardwalk entrance on Stillwell Ave.',
      location: { latitude: 40.5749, longitude: -73.985 },
      tier: 'medium',
      start: -1,
      hours: 2,
      maxXp: 300,
      organizer: person('coney_cleanup'),
      others: ['surfside_sue', 'mike_t'],
    },
  ];

  return samples.map((s, i) => {
    const isOrganizer = s.organizer.id === me.id;
    const joined = isOrganizer || !!s.joined;
    const everyone: Attendee[] = [
      { user: s.organizer, isOrganizer: true, status: 'signed_up' },
      ...s.others.map((username) => ({ user: person(username), isOrganizer: false, status: 'signed_up' as const })),
      ...(joined && !isOrganizer
        ? [{ user: { id: me.id, username: me.username }, isOrganizer: false, status: 'signed_up' as const }]
        : []),
    ];
    // Like the API, only the organizer gets attendees' emails.
    const attendees = isOrganizer
      ? everyone.map((a) => ({ ...a, email: `${a.user.username}@example.com` }))
      : everyone;

    return {
      id: `sample-${i + 1}`,
      questId: `sample-quest-${i + 1}`,
      title: s.title,
      description: s.description,
      location: s.location,
      difficultyTier: s.tier,
      status: s.start < 0 ? 'active' : 'scheduled',
      scheduledStart: at(s.start),
      scheduledEnd: at(s.start + s.hours),
      organizer: s.organizer,
      maxXp: s.maxXp,
      photo: { id: `sample-photo-${i + 1}`, url: '' },
      attendeeCount: attendees.length,
      joined,
      isOrganizer,
      distanceM: metersBetween(from, s.location),
      attendees,
    };
  });
}

// Joins or leaves a sample event locally, the way the API would.
export function setSampleAttendance(event: SampleEvent, me: Me, join: boolean): SampleEvent {
  if (event.isOrganizer || event.joined === join) return event;
  const attendees = join
    ? [...event.attendees, { user: { id: me.id, username: me.username }, isOrganizer: false, status: 'signed_up' as const }]
    : event.attendees.filter((a) => a.user.id !== me.id);
  return { ...event, joined: join, attendees, attendeeCount: attendees.length };
}
