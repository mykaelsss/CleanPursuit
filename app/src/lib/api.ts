import { Platform } from 'react-native';

// The Android emulator reaches the host machine at 10.0.2.2. On a physical device, set
// EXPO_PUBLIC_API_URL to the computer's LAN address, such as http://192.168.1.20:3000.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export interface User {
  id: string;
  username: string;
  email: string;
  totalXp: number;
  level: Level;
  createdAt: string;
}

// Computed by the API from totalXp; see docs/mvp.md#levels.
export interface Level {
  number: number;
  // XP earned since reaching this level.
  xpIntoLevel: number;
  // XP this level takes to finish; null at the max level.
  xpForNextLevel: number | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export type Session = Tokens & { user: User };

// Users with equal XP share a rank.
export type LeaderboardPeriod = 'all' | 'day' | 'week' | 'month';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  xp: number;
  totalXp: number;
}

export interface Leaderboard {
  period: LeaderboardPeriod;
  periodStart: string | null;
  entries: LeaderboardEntry[];
  limit: number;
  // A user without positive XP in this period is unranked, even if they have all-time XP.
  me: { rank: number | null; xp: number; totalXp: number };
}

export type DifficultyTier = 'easy' | 'medium' | 'hard' | 'legendary';

export type LocationPoint = { latitude: number; longitude: number };
export type Category = { code: string; label: string };
export type Hazard = Category & { warning: string; requiresDropoff: boolean };
export type ReportTags = { categories: Category[]; hazards: Hazard[] };
export type VolumeRange = { minGallons: number; maxGallons: number };
export type VolumeEstimate = VolumeRange & {
  bags: { size: 'kitchen' | 'large' | 'contractor'; gallons: number; min: number; max: number }[];
};
export interface PhotoAnalysis {
  fileId: string;
  showsLitter: boolean;
  // A suggested quest title; null when there is no litter.
  title: string | null;
  description: string;
  categories: string[];
  hazards: string[];
  estimatedVolume: VolumeEstimate | null;
}
export interface ReportInput {
  photoFileId: string;
  description: string;
  location: LocationPoint;
  placeName?: string;
  categories: string[];
  hazards: string[];
  estimatedVolume?: VolumeRange;
}
export interface LitterReport {
  id: string;
  description: string;
  location: LocationPoint;
  placeName: string | null;
  difficultyTier: DifficultyTier;
  estimatedVolume: VolumeEstimate | null;
  categories: Category[];
  hazards: Hazard[];
  photo: { id: string; url: string };
  questId: string | null;
  duplicateOf: { reportId: string; questId: string | null } | null;
}
export interface Quest {
  id: string;
  title: string;
  status: 'open' | 'completed' | 'cancelled' | 'expired';
  report: LitterReport;
  // The most XP one member can earn in a party on this quest, set by its difficulty tier.
  maxXp: number;
  // The walk-up cleanup under way, or null. Anyone at the spot can check in to join or start one.
  walkUp: WalkUp | null;
}

// A quest's walk-up cleanup under way: a party with no schedule that anyone at the spot can join.
export interface WalkUp {
  partyId: string;
  leader: { id: string; username: string };
  startedAt: string;
  // Members on site now.
  checkedInCount: number;
}

export interface PartyMember {
  userId: string;
  username: string;
  status: 'signed_up' | 'checked_in' | 'left' | 'no_show';
  signedUpAt: string;
  checkedInAt: string | null;
  leftAt: string | null;
}

// One attempt at a quest, from the /parties routes. A walk-up has no schedule.
export interface Party {
  id: string;
  questId: string;
  leader: { id: string; username: string };
  status: 'scheduled' | 'active' | 'partial' | 'completed' | 'abandoned' | 'cancelled';
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  bagCount: number | null;
  afterPhotoFileId: string | null;
  members: PartyMember[];
  createdAt: string;
}

export type AuthedRequest = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

// An event is a scheduled cleanup on a quest. The organizer is the party leader.
export interface CleanupEvent {
  id: string;
  questId: string;
  title: string;
  description: string;
  location: { latitude: number; longitude: number };
  // A readable name the reporter gave the spot; null on older reports.
  placeName: string | null;
  // The report's H3 area, to match against hotspots.
  areaId: string;
  difficultyTier: DifficultyTier;
  status: 'scheduled' | 'active';
  scheduledStart: string;
  scheduledEnd: string;
  organizer: { id: string; username: string };
  maxXp: number;
  photo: { id: string; url: string };
  attendeeCount: number;
  joined: boolean;
  isOrganizer: boolean;
  // A walk-up cleanup under way on the event's quest, which anyone at the spot can join now.
  walkUp: WalkUp | null;
}

export type NearbyEvent = CleanupEvent & { distanceM: number };

// An open quest as it appears on the map and in lists, from GET /quests.
export interface NearbyQuest {
  id: string;
  title: string;
  status: Quest['status'];
  difficultyTier: DifficultyTier;
  location: LocationPoint;
  placeName: string | null;
  distanceM: number;
  areaId: string;
  // Hazard codes, such as `sharps`.
  hazards: string[];
  photo: { id: string; url: string };
  maxXp: number;
  walkUp: WalkUp | null;
  createdAt: string;
}

// An H3 area reported in the last 30 days, from GET /hotspots.
export interface HotspotArea {
  areaId: string;
  latitude: number;
  longitude: number;
  // The hexagon's corners.
  boundary: LocationPoint[];
  distinctReporters: number;
  reports: number;
  lastReportedDay: string;
  // Reported by enough different people that cleaning it earns bonus XP.
  isHotspot: boolean;
}

export interface Attendee {
  user: { id: string; username: string };
  // Only sent to the event's organizer.
  email?: string;
  isOrganizer: boolean;
  status: 'signed_up' | 'checked_in';
}

export type EventDetail = CleanupEvent & { attendees: Attendee[] };

// Mirrors the API's `errorSchema`. `code` is stable, so callers branch on it rather than on `message`.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function request<T>(
  path: string,
  { method = 'GET', body, accessToken }: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.code, data?.message ?? 'Something went wrong');
  }
  return data as T;
}

export const authApi = {
  register: (body: { username: string; email: string; password: string }) =>
    request<Session>('/auth/register', { method: 'POST', body }),
  login: (body: { identifier: string; password: string }) =>
    request<Session>('/auth/login', { method: 'POST', body }),
  refresh: (refreshToken: string) => request<Tokens>('/auth/refresh', { method: 'POST', body: { refreshToken } }),
  logout: (refreshToken: string) => request<void>('/auth/logout', { method: 'POST', body: { refreshToken } }),
  me: (accessToken: string) => request<User>('/me', { accessToken }),
};

export interface EquipmentItem {
  id: string;
  name: string;
  description: string | null;
  // Volunteers must bring it, such as a sharps container for sharps. Required items come first.
  required: boolean;
}

export interface QuestEquipment {
  questId: string;
  items: EquipmentItem[];
  hazards: Hazard[];
}

export interface Dropoff {
  id: string;
  name: string;
  address: string;
  location: LocationPoint;
  distanceM: number;
  phone: string | null;
  hours: string | null;
  // Where to find the drop-off at the site, such as "Lobby".
  notes: string | null;
  // False for sites found by a Google search, which may not accept sharps.
  verified: boolean;
  googlePlaceId: string | null;
}

export interface Escalation {
  name: string;
  phone: string;
  url: string;
  message: string;
}

export interface QuestDropoffs {
  requiresDropoff: boolean;
  dropoffs: Dropoff[];
  escalation: Escalation;
}
