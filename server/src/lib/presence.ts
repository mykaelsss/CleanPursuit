// Presence rules for parties. Temporary MVP values; revisit after end-to-end demo testing.
// Keep docs/mvp.md in sync with these numbers.

// Check-in and on-site pings must be this close to the report location.
export const CHECK_IN_GEOFENCE_RADIUS_METERS = 100;
// The most time one gap between two on-site pings can count toward time on site.
export const PRESENCE_MAX_GAP_MINUTES = 10;
// A walk-up member with no on-site ping for this long has left.
export const MEMBER_TIMEOUT_MINUTES = 30;
