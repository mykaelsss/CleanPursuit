import { z } from 'zod';

// Everything specific to the region the app serves. Only New York City for now.

export const escalationSchema = z.object({
  name: z.string(),
  phone: z.string(),
  url: z.url(),
  message: z.string(),
});

export type Escalation = z.infer<typeof escalationSchema>;

export interface Region {
  name: string;
  // Who to call about sharps or biohazard, shown on every hazard quest as the recommended approach.
  escalation: Escalation;
  // What to search Google Places for when no listed drop-off site is near a quest.
  // Plain "sharps disposal" finds medical waste haulers in NYC; syringe service programs take drop-offs.
  dropoffSearchQuery: string;
}

export const NYC: Region = {
  name: 'New York City',
  escalation: {
    name: 'NYC 311',
    phone: '311',
    url: 'https://portal.311.nyc.gov/',
    message:
      'The recommended approach is to call 311. The city sends Sanitation, or Parks inside a park, to collect needles and biological waste on public property, usually within a few days.',
  },
  dropoffSearchQuery: 'syringe service program',
};

export const region = NYC;
