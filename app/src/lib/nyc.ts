// The five boroughs' bounding box. The events map cannot pan or zoom out beyond it.
export const NYC_BOUNDS = {
  southWest: { latitude: 40.4774, longitude: -74.2591 },
  northEast: { latitude: 40.9176, longitude: -73.7004 },
};

// Lower Manhattan and Brooklyn, shown before the user's location is known or when they are outside NYC.
export const NYC_REGION = {
  latitude: 40.7128,
  longitude: -73.97,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};

// Zoomed out this far, the map shows all five boroughs and no more.
export const NYC_MIN_ZOOM = 10;

export function isInNyc({ latitude, longitude }: { latitude: number; longitude: number }): boolean {
  return (
    latitude >= NYC_BOUNDS.southWest.latitude &&
    latitude <= NYC_BOUNDS.northEast.latitude &&
    longitude >= NYC_BOUNDS.southWest.longitude &&
    longitude <= NYC_BOUNDS.northEast.longitude
  );
}
