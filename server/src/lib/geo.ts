import { z } from 'zod';

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type Location = z.infer<typeof locationSchema>;

// A readable name for a spot, shown instead of coordinates.
export const placeNameSchema = z.string().describe('A readable name for the spot, such as "Tompkins Square Park, East Village"');

// SQL for a geography point from longitude and latitude parameters, for example `geographyPoint(2, 1)`.
// PostGIS takes longitude first.
export function geographyPoint(longitudeParam: number, latitudeParam: number): string {
  return `ST_SetSRID(ST_MakePoint($${longitudeParam}, $${latitudeParam}), 4326)::geography`;
}

// SQL that selects a geography column as `latitude` and `longitude`.
export function selectLocation(column: string): string {
  return `ST_Y(${column}::geometry) AS latitude, ST_X(${column}::geometry) AS longitude`;
}

const EARTH_RADIUS_M = 6_371_008.8;

// Great-circle distance in meters. Within a fraction of a percent of PostGIS geography distances.
export function distanceMeters(a: Location, b: Location): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
