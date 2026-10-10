import { z } from 'zod';

// Thrown from routes and hooks; the app's error handler turns it into an `errorSchema` response.
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// The body of every error response. `code` is stable, so the app can branch on it.
export const errorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string().optional(),
  error: z.string(),
  message: z.string(),
});
