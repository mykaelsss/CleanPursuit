import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { USER_COLUMNS, type UserRow, toUser, userSchema } from '../lib/users.ts';

const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['users'],
        summary: 'Get the signed-in user',
        security: [{ bearerAuth: [] }],
        response: { 200: userSchema, 401: errorSchema },
      },
    },
    async (request) => {
      const { rows } = await app.db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1`, [
        request.user.id,
      ]);
      const row = rows[0];
      // The token is valid but the account was deleted.
      if (!row) throw new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid');
      return toUser(row);
    },
  );
};

export default meRoutes;
