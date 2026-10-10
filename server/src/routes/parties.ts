import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { withTransaction } from "../lib/db.ts";
import { errorSchema, HttpError } from "../lib/errors.ts";
import { perUserRateLimit } from "../lib/rate-limit.ts";

const security = [{ bearerAuth: [] }];

const partyStatusSchema = z.enum([
	"scheduled",
	"active",
	"partial",
	"completed",
	"abandoned",
	"cancelled",
]);

const memberStatusSchema = z.enum([
	"signed_up",
	"checked_in",
	"left",
	"no_show",
]);

const memberSchema = z.object({
	userId: z.uuid(),
	username: z.string(),
	status: memberStatusSchema,
	signedUpAt: z.iso.datetime(),
	checkedInAt: z.iso.datetime().nullable(),
	leftAt: z.iso.datetime().nullable(),
});

const partySchema = z.object({
	id: z.uuid(),
	questId: z.uuid(),
	leader: z.object({ id: z.uuid(), username: z.string() }),
	status: partyStatusSchema,
	scheduledStart: z.iso.datetime().nullable(),
	scheduledEnd: z.iso.datetime().nullable(),
	startedAt: z.iso.datetime().nullable(),
	endedAt: z.iso.datetime().nullable(),
	bagCount: z.number().int().nullable(),
	afterPhotoFileId: z.uuid().nullable(),
	members: z.array(memberSchema),
	createdAt: z.iso.datetime(),
});

type PartyStatus = z.infer<typeof partyStatusSchema>;

async function findParty(
	app: Parameters<FastifyPluginAsyncZod>[0],
	partyId: string,
) {
	const partyResult = await app.db.query<{
		id: string;
		quest_id: string;
		leader_user_id: string;
		leader_username: string;
		status: PartyStatus;
		scheduled_start: Date | null;
		scheduled_end: Date | null;
		started_at: Date | null;
		ended_at: Date | null;
		bag_count: number | null;
		after_photo_file_id: string | null;
		created_at: Date;
	}>(
		`SELECT p.id, p.quest_id, p.leader_user_id, u.username AS leader_username,
            p.status, p.scheduled_start, p.scheduled_end, p.started_at, p.ended_at,
            p.bag_count, p.after_photo_file_id, p.created_at
     FROM party p
     JOIN app_user u ON u.id = p.leader_user_id
     WHERE p.id = $1`,
		[partyId],
	);

	const row = partyResult.rows[0];
	if (!row) return null;

	const membersResult = await app.db.query<{
		user_id: string;
		username: string;
		status: z.infer<typeof memberStatusSchema>;
		signed_up_at: Date;
		checked_in_at: Date | null;
		left_at: Date | null;
	}>(
		`SELECT pm.user_id, u.username, pm.status, pm.signed_up_at, pm.checked_in_at, pm.left_at
     FROM party_member pm
     JOIN app_user u ON u.id = pm.user_id
     WHERE pm.party_id = $1
     ORDER BY pm.signed_up_at, pm.user_id`,
		[partyId],
	);

	return {
		id: row.id,
		questId: row.quest_id,
		leader: { id: row.leader_user_id, username: row.leader_username },
		status: row.status,
		scheduledStart: row.scheduled_start?.toISOString() ?? null,
		scheduledEnd: row.scheduled_end?.toISOString() ?? null,
		startedAt: row.started_at?.toISOString() ?? null,
		endedAt: row.ended_at?.toISOString() ?? null,
		bagCount: row.bag_count,
		afterPhotoFileId: row.after_photo_file_id,
		members: membersResult.rows.map((member) => ({
			userId: member.user_id,
			username: member.username,
			status: member.status,
			signedUpAt: member.signed_up_at.toISOString(),
			checkedInAt: member.checked_in_at?.toISOString() ?? null,
			leftAt: member.left_at?.toISOString() ?? null,
		})),
		createdAt: row.created_at.toISOString(),
	};
}

const partyRoutes: FastifyPluginAsyncZod = async (app) => {
	// Create a scheduled cleanup event. The creator is automatically its first member and leader.
	app.post(
		"/quests/:questId/parties",
		{
			onRequest: app.authenticate,
			config: { rateLimit: perUserRateLimit(20, "1 hour") },
			schema: {
				tags: ["parties"],
				summary: "Schedule a cleanup party for a quest",
				security,
				params: z.object({ questId: z.uuid() }),
				body: z.object({
					scheduledStart: z.iso.datetime(),
					scheduledEnd: z.iso.datetime(),
				}),
				response: {
					201: partySchema,
					400: errorSchema,
					401: errorSchema,
					404: errorSchema,
					409: errorSchema,
					429: errorSchema,
				},
			},
		},
		async (request, reply) => {
			const start = new Date(request.body.scheduledStart);
			const end = new Date(request.body.scheduledEnd);
			if (end <= start || start <= new Date()) {
				throw new HttpError(
					400,
					"INVALID_SCHEDULE",
					"The end must be after the start, and the start must be in the future",
				);
			}

			const partyId = await withTransaction(app.db, async (client) => {
				const quest = await client.query<{ status: string }>(
					`SELECT status FROM quest WHERE id = $1 FOR SHARE`,
					[request.params.questId],
				);
				if (!quest.rows[0])
					throw new HttpError(404, "QUEST_NOT_FOUND", "Quest not found");
				if (quest.rows[0].status !== "open") {
					throw new HttpError(
						409,
						"QUEST_NOT_OPEN",
						"Parties can only be scheduled for open quests",
					);
				}

				const inserted = await client.query<{ id: string }>(
					`INSERT INTO party (quest_id, leader_user_id, status, scheduled_start, scheduled_end)
           VALUES ($1, $2, 'scheduled', $3, $4)
           RETURNING id`,
					[request.params.questId, request.user.id, start, end],
				);
				const id = inserted.rows[0]!.id;

				await client.query(
					`INSERT INTO party_member (party_id, user_id, status)
           VALUES ($1, $2, 'signed_up')`,
					[id, request.user.id],
				);

				return id;
			});

			const party = await findParty(app, partyId);

			if (!party) {
				throw new HttpError(
					500,
					"PARTY_CREATE_FETCH_FAILED",
					"Failed to load created party",
				);
			}

			return reply.status(201).send(party);
		},
	);

	// Join an upcoming scheduled party. Walk-up parties use a separate endpoint and check-in flow.
	app.post(
		"/parties/:partyId/join",
		{
			onRequest: app.authenticate,
			config: { rateLimit: perUserRateLimit(30, "1 hour") },
			schema: {
				tags: ["parties"],
				summary: "Join a scheduled cleanup party",
				security,
				params: z.object({ partyId: z.uuid() }),
				response: {
					200: partySchema,
					400: errorSchema,
					401: errorSchema,
					404: errorSchema,
					409: errorSchema,
					429: errorSchema,
				},
			},
		},
		async (request) => {
			await withTransaction(app.db, async (client) => {
				const result = await client.query<{
					status: PartyStatus;
					scheduled_start: Date | null;
				}>(
					`SELECT status, scheduled_start
           FROM party
           WHERE id = $1
           FOR UPDATE`,
					[request.params.partyId],
				);
				const party = result.rows[0];
				if (!party)
					throw new HttpError(404, "PARTY_NOT_FOUND", "Party not found");
				if (
					party.status !== "scheduled" ||
					!party.scheduled_start ||
					party.scheduled_start <= new Date()
				) {
					throw new HttpError(
						409,
						"PARTY_NOT_JOINABLE",
						"Only parties that are scheduled for the future can be joined",
					);
				}

				const existing = await client.query<{ status: string }>(
					`SELECT status FROM party_member WHERE party_id = $1 AND user_id = $2`,
					[request.params.partyId, request.user.id],
				);
				if (existing.rows[0]) {
					if (existing.rows[0].status === "signed_up") return;
					throw new HttpError(
						409,
						"MEMBERSHIP_ALREADY_EXISTS",
						"You have already participated in this party",
					);
				}

				await client.query(
					`INSERT INTO party_member (party_id, user_id, status)
           VALUES ($1, $2, 'signed_up')`,
					[request.params.partyId, request.user.id],
				);
			});

			return (await findParty(app, request.params.partyId))!;
		},
	);

	app.get(
		"/parties/:partyId",
		{
			onRequest: app.authenticate,
			schema: {
				tags: ["parties"],
				summary: "Get a party and its members",
				security,
				params: z.object({ partyId: z.uuid() }),
				response: {
					200: partySchema,
					400: errorSchema,
					401: errorSchema,
					404: errorSchema,
				},
			},
		},
		async (request) => {
			const party = await findParty(app, request.params.partyId);
			if (!party)
				throw new HttpError(404, "PARTY_NOT_FOUND", "Party not found");
			return party;
		},
	);
};

export default partyRoutes;
