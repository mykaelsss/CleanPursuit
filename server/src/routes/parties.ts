import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { withTransaction } from "../lib/db.ts";
import { errorSchema, HttpError } from "../lib/errors.ts";
import { perUserRateLimit } from "../lib/rate-limit.ts";
import { geographyPoint, locationSchema } from "../lib/geo.ts";

const security = [{ bearerAuth: [] }];
// Temporary MVP value; revisit after end-to-end demo testing.
const CHECK_IN_GEOFENCE_RADIUS_METERS = 100;

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

	// Check in to a scheduled cleanup party.
	app.post(
		"/parties/:partyId/check-in",
		{
			onRequest: app.authenticate,
			config: { rateLimit: perUserRateLimit(30, "1 hour") },
			schema: {
				tags: ["parties"],
				summary: "Check in to a scheduled cleanup party",
				security,
				params: z.object({ partyId: z.uuid() }),
				body: z.object({ location: locationSchema }),
				response: {
					200: partySchema,
					400: errorSchema,
					401: errorSchema,
					403: errorSchema,
					404: errorSchema,
					409: errorSchema,
					429: errorSchema,
				},
			},
		},
		async (request) => {
			const { partyId } = request.params;
			const userId = request.user.id;
			const { latitude, longitude } = request.body.location;

			await withTransaction(app.db, async (client) => {
				// Lock the party so concurrent check-ins are serialized.
				const result = await client.query<{
					status: PartyStatus;
					scheduled_start: Date | null;
					scheduled_end: Date | null;
					quest_status: string;
					quest_id: string;
					area_id: string;
					on_site: boolean;
				}>(
					`SELECT
             p.status,
             p.scheduled_start,
             p.scheduled_end,
             q.status AS quest_status,
             q.id AS quest_id,
             r.area_id AS area_id,
             ST_DWithin(
               r.location,
               ${geographyPoint(2, 3)},
               $4
             ) AS on_site
           FROM party p
           JOIN quest q ON q.id = p.quest_id
           JOIN report r ON r.id = q.report_id
           WHERE p.id = $1
           FOR UPDATE OF p`,
					[partyId, longitude, latitude, CHECK_IN_GEOFENCE_RADIUS_METERS],
				);

				const party = result.rows[0];

				if (!party) {
					throw new HttpError(404, "PARTY_NOT_FOUND", "Party not found");
				}

				if (party.quest_status !== "open") {
					throw new HttpError(
						409,
						"QUEST_NOT_OPEN",
						"Cannot check in to a party whose quest is not open",
					);
				}

				if (party.status !== "scheduled" && party.status !== "active") {
					throw new HttpError(
						409,
						"PARTY_NOT_CHECKINABLE",
						"This party is not accepting check-ins",
					);
				}

				if (!party.scheduled_start || !party.scheduled_end) {
					throw new HttpError(
						409,
						"PARTY_NOT_SCHEDULED",
						"Use walk-up check-in for parties without a schedule",
					);
				}

				const now = new Date();

				if (party.scheduled_start > now) {
					throw new HttpError(
						409,
						"CHECK_IN_NOT_OPEN",
						"Check-in opens at the scheduled start time",
					);
				}

				if (party.scheduled_end <= now) {
					throw new HttpError(
						409,
						"CHECK_IN_CLOSED",
						"The scheduled party has ended",
					);
				}

				// Only users who signed up can check in.
				const memberResult = await client.query<{ status: string }>(
					`SELECT status
           FROM party_member
           WHERE party_id = $1 AND user_id = $2
           FOR UPDATE`,
					[partyId, userId],
				);

				const member = memberResult.rows[0];

				if (!member) {
					throw new HttpError(
						409,
						"PARTY_MEMBERSHIP_REQUIRED",
						"Sign up for this party before checking in",
					);
				}

				if (member.status !== "signed_up" && member.status !== "checked_in") {
					throw new HttpError(
						409,
						"MEMBERSHIP_NOT_CHECKINABLE",
						"This membership cannot check in",
					);
				}

				if (!party.on_site) {
					throw new HttpError(
						403,
						"CHECK_IN_OUTSIDE_GEOFENCE",
						"You must be at the cleanup location to check in",
					);
				}

				if (member.status === "signed_up") {
					await client.query(
						`UPDATE party_member
             SET status = 'checked_in',
                 checked_in_at = now(),
                 last_on_site_at = now()
             WHERE party_id = $1 AND user_id = $2`,
						[partyId, userId],
					);

					// The first check-in starts the party.
					await client.query(
						`UPDATE party
             SET status = 'active',
                 started_at = COALESCE(started_at, now())
             WHERE id = $1`,
						[partyId],
					);

					await client.query(
						`INSERT INTO activity_event
               (kind, user_id, area_id, quest_id, party_id)
             VALUES ('party_checked_in', $1, $2, $3, $4)`,
						[userId, party.area_id, party.quest_id, partyId],
					);
				} else {
					// Repeated check-in refreshes presence without resetting
					// the original check-in time or duplicating the activity event.
					await client.query(
						`UPDATE party_member
             SET last_on_site_at = now()
             WHERE party_id = $1 AND user_id = $2`,
						[partyId, userId],
					);
				}

				await client.query(
					`INSERT INTO presence_ping
             (party_id, user_id, recorded_at, location, on_site)
           VALUES ($1, $2, now(), ${geographyPoint(3, 4)}, true)`,
					[partyId, userId, longitude, latitude],
				);
			});

			const updatedParty = await findParty(app, partyId);

			if (!updatedParty) {
				throw new HttpError(
					500,
					"PARTY_CHECK_IN_FETCH_FAILED",
					"Failed to load party after check-in",
				);
			}

			return updatedParty;
		},
	);

	app.post(
		"/parties/:partyId/presence",
		{
			onRequest: app.authenticate,
			config: { rateLimit: perUserRateLimit(120, "1 hour") },
			schema: {
				tags: ["parties"],
				summary: "Record a party member's location ping",
				security,
				params: z.object({ partyId: z.uuid() }),
				body: z.object({ location: locationSchema }),
				response: {
					200: z.object({
						partyId: z.uuid(),
						recordedAt: z.iso.datetime(),
						onSite: z.boolean(),
					}),
					400: errorSchema,
					401: errorSchema,
					404: errorSchema,
					409: errorSchema,
					429: errorSchema,
				},
			},
		},
		async (request) => {
			const { partyId } = request.params;
			const userId = request.user.id;
			const { latitude, longitude } = request.body.location;

			return withTransaction(app.db, async (client) => {
				const partyResult = await client.query<{
					status: PartyStatus;
					quest_status: string;
					on_site: boolean;
				}>(
					`SELECT
             p.status,
             q.status AS quest_status,
             ST_DWithin(
               r.location,
               ${geographyPoint(2, 3)},
               $4
             ) AS on_site
           FROM party p
           JOIN quest q ON q.id = p.quest_id
           JOIN report r ON r.id = q.report_id
           WHERE p.id = $1
           FOR UPDATE OF p`,
					[partyId, longitude, latitude, CHECK_IN_GEOFENCE_RADIUS_METERS],
				);

				const party = partyResult.rows[0];

				if (!party) {
					throw new HttpError(404, "PARTY_NOT_FOUND", "Party not found");
				}

				if (party.status !== "active" || party.quest_status !== "open") {
					throw new HttpError(
						409,
						"PARTY_NOT_ACTIVE",
						"Presence pings require an active party with an open quest",
					);
				}

				const memberResult = await client.query<{ status: string }>(
					`SELECT status
           FROM party_member
           WHERE party_id = $1 AND user_id = $2
           FOR UPDATE`,
					[partyId, userId],
				);

				if (memberResult.rows[0]?.status !== "checked_in") {
					throw new HttpError(
						409,
						"MEMBER_NOT_CHECKED_IN",
						"You must be checked in to record presence",
					);
				}

				const pingResult = await client.query<{ recorded_at: Date }>(
					`INSERT INTO presence_ping
             (party_id, user_id, recorded_at, location, on_site)
           VALUES (
             $1,
             $2,
             clock_timestamp(),
             ${geographyPoint(3, 4)},
             $5
           )
           RETURNING recorded_at`,
					[partyId, userId, longitude, latitude, party.on_site],
				);

				const recordedAt = pingResult.rows[0]!.recorded_at;

				if (party.on_site) {
					await client.query(
						`UPDATE party_member
             SET last_on_site_at = $3
             WHERE party_id = $1 AND user_id = $2`,
						[partyId, userId, recordedAt],
					);
				}

				return {
					partyId,
					recordedAt: recordedAt.toISOString(),
					onSite: party.on_site,
				};
			});
		},
	);

	// End an active scheduled cleanup and award time-based XP.
	app.post(
		"/parties/:partyId/end",
		{
			onRequest: app.authenticate,
			config: { rateLimit: perUserRateLimit(10, "1 hour") },
			schema: {
				tags: ["parties"],
				summary: "End a cleanup party",
				security,
				params: z.object({ partyId: z.uuid() }),
				body: z.object({
					afterPhotoFileId: z.uuid(),
					bagCount: z.number().int().min(0),
					outcome: z.enum(["completed", "partial"]),
				}),
				response: {
					200: partySchema,
					400: errorSchema,
					401: errorSchema,
					403: errorSchema,
					404: errorSchema,
					409: errorSchema,
					429: errorSchema,
				},
			},
		},
		async (request) => {
			const { partyId } = request.params;
			const { afterPhotoFileId, bagCount, outcome } = request.body;
			const userId = request.user.id;

			await withTransaction(app.db, async (client) => {
				// Lock both records to serialize concurrent attempts to end a party
				// and to complete its quest.
				const result = await client.query<{
					quest_id: string;
					leader_user_id: string;
					status: PartyStatus;
					scheduled_start: Date | null;
					scheduled_end: Date | null;
					quest_status: string;
					area_id: string;
				}>(
					`SELECT
             p.quest_id,
             p.leader_user_id,
             p.status,
             p.scheduled_start,
             p.scheduled_end,
             q.status AS quest_status,
             r.area_id::text AS area_id
           FROM party p
           JOIN quest q ON q.id = p.quest_id
           JOIN report r ON r.id = q.report_id
           WHERE p.id = $1
           FOR UPDATE OF p, q`,
					[partyId],
				);

				const party = result.rows[0];

				if (!party) {
					throw new HttpError(404, "PARTY_NOT_FOUND", "Party not found");
				}

				if (party.leader_user_id !== userId) {
					throw new HttpError(
						403,
						"PARTY_LEADER_REQUIRED",
						"Only the party leader can end this cleanup",
					);
				}

				if (party.status !== "active") {
					throw new HttpError(
						409,
						"PARTY_NOT_ACTIVE",
						"Only an active party can be ended",
					);
				}

				if (party.quest_status !== "open") {
					throw new HttpError(
						409,
						"QUEST_NOT_OPEN",
						"The quest is no longer open",
					);
				}

				// This demo flow uses scheduled event duration for XP calculation.
				// Walk-up parties are deferred to a later milestone.
				if (!party.scheduled_start || !party.scheduled_end) {
					throw new HttpError(
						409,
						"PARTY_NOT_SCHEDULED",
						"Ending walk-up parties is not supported yet",
					);
				}

				const nowResult = await client.query<{ ended_at: Date }>(
					`SELECT clock_timestamp() AS ended_at`,
				);
				const endedAt = nowResult.rows[0]!.ended_at;

				// A confirmed after photo must belong to the leader and must not
				// already be attached to a report or another party.
				const fileResult = await client.query<{
					uploaded_by_user_id: string;
					content_type: string;
					is_used: boolean;
				}>(
					`SELECT
             f.uploaded_by_user_id,
             f.content_type,
             (
               EXISTS (
                 SELECT 1 FROM report r WHERE r.photo_file_id = f.id
               )
               OR EXISTS (
                 SELECT 1 FROM party p WHERE p.after_photo_file_id = f.id
               )
             ) AS is_used
           FROM file f
           WHERE f.id = $1
           FOR UPDATE OF f`,
					[afterPhotoFileId],
				);

				const file = fileResult.rows[0];

				if (!file || file.uploaded_by_user_id !== userId) {
					throw new HttpError(
						400,
						"AFTER_PHOTO_NOT_AVAILABLE",
						"Upload and confirm an after photo using your account",
					);
				}

				if (
					!["image/jpeg", "image/png", "image/webp"].includes(file.content_type)
				) {
					throw new HttpError(
						400,
						"INVALID_AFTER_PHOTO",
						"The after photo must be a JPEG, PNG or WebP image",
					);
				}

				if (file.is_used) {
					throw new HttpError(
						409,
						"PHOTO_ALREADY_USED",
						"That photo is already attached to something else",
					);
				}

				// Lock memberships and capture the last verified on-site timestamp.
				const membersResult = await client.query<{
					user_id: string;
					status: string;
					checked_in_at: Date | null;
					last_on_site_at: Date | null;
					guild_id: string | null;
				}>(
					`SELECT
             pm.user_id,
             pm.status,
             pm.checked_in_at,
             pm.last_on_site_at,
             gm.guild_id
           FROM party_member pm
           LEFT JOIN guild_member gm ON gm.user_id = pm.user_id
           WHERE pm.party_id = $1
           FOR UPDATE OF pm`,
					[partyId],
				);

				const durationMinutes = Math.min(
					100,
					Math.max(
						1,
						Math.floor(
							(party.scheduled_end.getTime() -
								party.scheduled_start.getTime()) /
								60_000,
						),
					),
				);

				const participants = membersResult.rows
					.filter(
						(member) =>
							member.checked_in_at !== null &&
							(member.status === "checked_in" || member.status === "left"),
					)
					.map((member) => {
						// Time on site ends at the last verified on-site ping. Never
						// count time before check-in, after the scheduled end, or after
						// this party-ending operation.
						const lastOnSiteAt =
							member.last_on_site_at ?? member.checked_in_at!;
						const cappedEnd = Math.min(
							lastOnSiteAt.getTime(),
							party.scheduled_end!.getTime(),
							endedAt.getTime(),
						);

						const minutesOnSite = Math.max(
							0,
							Math.floor(
								(cappedEnd - member.checked_in_at!.getTime()) / 60_000,
							),
						);

						const xp = Math.floor(
							(100 * Math.min(minutesOnSite, durationMinutes)) /
								durationMinutes,
						);

						return {
							userId: member.user_id,
							guildId: member.guild_id,
							minutesOnSite,
							xp,
						};
					});

				// Finish current participants and close sign-ups. Members who never
				// checked in do not earn XP.
				await client.query(
					`UPDATE party_member
           SET status = 'left',
               left_at = $2,
               left_reason = 'party_ended'
           WHERE party_id = $1 AND status = 'checked_in'`,
					[partyId, endedAt],
				);

				await client.query(
					`UPDATE party_member
           SET status = 'no_show'
           WHERE party_id = $1 AND status = 'signed_up'`,
					[partyId],
				);

				// Log departures caused by the party ending.
				for (const member of membersResult.rows) {
					if (member.status !== "checked_in") continue;

					await client.query(
						`INSERT INTO activity_event
               (kind, user_id, guild_id, area_id, quest_id, party_id)
             VALUES ('party_left', $1, $2, $3, $4, $5)`,
						[
							member.user_id,
							member.guild_id,
							party.area_id,
							party.quest_id,
							partyId,
						],
					);
				}

				const finalStatus = outcome === "completed" ? "completed" : "partial";

				await client.query(
					`UPDATE party
           SET status = $2,
               ended_at = $3,
               bag_count = $4,
               after_photo_file_id = $5
           WHERE id = $1`,
					[partyId, finalStatus, endedAt, bagCount, afterPhotoFileId],
				);

				await client.query(
					`INSERT INTO activity_event
             (kind, user_id, guild_id, area_id, quest_id, party_id, bag_count)
           VALUES ('party_ended', $1, $2, $3, $4, $5, $6)`,
					[
						userId,
						participants.find((member) => member.userId === userId)?.guildId ??
							null,
						party.area_id,
						party.quest_id,
						partyId,
						bagCount,
					],
				);

				// Award a hotspot bonus only for completed cleanups in areas with
                            // at least three distinct reporters in the last 30 days.
                            const hotspotResult =
                                    outcome === "completed"
                                            ? await client.query<{
                                                      distinct_reporters: number | string;
                                              }>(
                                                      `SELECT distinct_reporters
                                                       FROM area_hotspot_30d
                                                       WHERE area_id = $1::h3index`,
                                                      [party.area_id],
                                              )
                                            : null;

                            const qualifiesForHotspotBonus =
                                    Number(
                                            hotspotResult?.rows[0]?.distinct_reporters ?? 0,
                                    ) >= 3;

                            // Record base XP and any eligible hotspot bonus.
                            for (const member of participants) {
                                    await client.query(
                                            `INSERT INTO activity_event
               (kind, user_id, guild_id, area_id, quest_id, party_id, xp, minutes_on_site)
             VALUES ('party_xp_awarded', $1, $2, $3, $4, $5, $6, $7)`,
                                            [
                                                    member.userId,
                                                    member.guildId,
                                                    party.area_id,
                                                    party.quest_id,
                                                    partyId,
                                                    member.xp,
                                                    member.minutesOnSite,
                                            ],
                                    );

                                    const hotspotBonusXp = qualifiesForHotspotBonus
                                            ? Math.min(
                                                      Math.floor((member.xp * 20) / 100),
                                                      Math.max(0, 100 - member.xp),
                                              )
                                            : 0;

                                    if (hotspotBonusXp > 0) {
                                            await client.query(
                                                    `INSERT INTO activity_event
                 (kind, user_id, guild_id, area_id, quest_id, party_id, xp)
               VALUES ('hotspot_bonus', $1, $2, $3, $4, $5, $6)`,
                                                    [
                                                            member.userId,
                                                            member.guildId,
                                                            party.area_id,
                                                            party.quest_id,
                                                            partyId,
                                                            hotspotBonusXp,
                                                    ],
                                            );
                                    }

                                    await client.query(
                                            `UPDATE app_user
             SET total_xp = total_xp + $2
             WHERE id = $1`,
                                            [member.userId, member.xp + hotspotBonusXp],
                                    );
                            }

				if (outcome === "completed") {
					await client.query(
						`UPDATE quest
             SET status = 'completed',
                 completed_at = $2
             WHERE id = $1 AND status = 'open'`,
						[party.quest_id, endedAt],
					);

					await client.query(
						`INSERT INTO activity_event
               (kind, user_id, guild_id, area_id, quest_id, party_id)
             VALUES ('quest_completed', $1, $2, $3, $4, $5)`,
						[
							userId,
							participants.find((member) => member.userId === userId)
								?.guildId ?? null,
							party.area_id,
							party.quest_id,
							partyId,
						],
					);
				}
				// A partial cleanup deliberately leaves the quest open.
			});

			const updatedParty = await findParty(app, partyId);

			if (!updatedParty) {
				throw new HttpError(
					500,
					"PARTY_END_FETCH_FAILED",
					"Failed to load party after ending",
				);
			}

			return updatedParty;
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
