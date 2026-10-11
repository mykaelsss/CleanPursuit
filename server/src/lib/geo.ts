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
