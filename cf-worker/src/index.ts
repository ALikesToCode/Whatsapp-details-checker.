interface Env {
	DB: D1Database;
}

type MemberAnalytics = {
	name: string;
	phoneNumber: string;
	stats: { messages: number; words: number; media: number; links: number; active_days: number };
	signals?: { answer_like: number; reply_helpfulness: number; long_msgs: number; unique_words: number; duplicate_count: number };
	analysis: { value_score: number; role: string; vibe: string };
	badges: string[];
	samples?: string[];
};

type UploadPayload = {
	source_label?: string;
	members: MemberAnalytics[];
};

type MemberRow = {
	name: string;
	phone_number: string | null;
	messages: number;
	words: number;
	media: number;
	links: number;
	active_days: number;
	answer_like: number;
	reply_helpfulness: number;
	long_msgs: number;
	unique_words: number;
	duplicate_count: number;
	value_score: number;
	role: string;
	vibe: string;
	badges_json: string | null;
	samples_json: string | null;
};

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(data), {
		headers: { 'Content-Type': 'application/json', ...corsHeaders, ...init.headers },
		status: init.status ?? 200,
	});
}

function notFound() {
	return jsonResponse({ error: 'not_found' }, { status: 404 });
}

function badRequest(message: string) {
	return jsonResponse({ error: 'bad_request', message }, { status: 400 });
}

async function readJson<T>(request: Request): Promise<T> {
	const text = await request.text();
	if (!text) throw new Error('empty body');
	return JSON.parse(text) as T;
}

function normalizeSignals(signals?: MemberAnalytics['signals']) {
	return {
		answer_like: signals?.answer_like ?? 0,
		reply_helpfulness: signals?.reply_helpfulness ?? 0,
		long_msgs: signals?.long_msgs ?? 0,
		unique_words: signals?.unique_words ?? 0,
		duplicate_count: signals?.duplicate_count ?? 0,
	};
}

async function insertUpload(env: Env, payload: UploadPayload) {
	const uploadId = crypto.randomUUID();
	const sourceLabel = payload.source_label ?? 'upload';
	const members = payload.members ?? [];

	const statements: D1PreparedStatement[] = [];
	statements.push(
		env.DB.prepare(
			'INSERT INTO chat_uploads (id, source_label) VALUES (?, ?)'
		).bind(uploadId, sourceLabel)
	);

	for (const member of members) {
		const memberId = crypto.randomUUID();
		const signals = normalizeSignals(member.signals);
		const badges = member.badges ?? [];
		const samplesJson = JSON.stringify(member.samples ?? []);

		statements.push(
			env.DB.prepare(
				'INSERT INTO members (id, upload_id, name, phone_number) VALUES (?, ?, ?, ?)'
			).bind(memberId, uploadId, member.name, member.phoneNumber)
		);
		statements.push(
			env.DB.prepare(
				'INSERT INTO member_stats (member_id, messages, words, media, links, active_days) VALUES (?, ?, ?, ?, ?, ?)'
			).bind(
				memberId,
				member.stats.messages,
				member.stats.words,
				member.stats.media,
				member.stats.links,
				member.stats.active_days
			)
		);
		statements.push(
			env.DB.prepare(
				'INSERT INTO member_signals (member_id, answer_like, reply_helpfulness, long_msgs, unique_words, duplicate_count) VALUES (?, ?, ?, ?, ?, ?)'
			).bind(
				memberId,
				signals.answer_like,
				signals.reply_helpfulness,
				signals.long_msgs,
				signals.unique_words,
				signals.duplicate_count
			)
		);
		statements.push(
			env.DB.prepare(
				'INSERT INTO member_analysis (member_id, value_score, role, vibe) VALUES (?, ?, ?, ?)'
			).bind(memberId, member.analysis.value_score, member.analysis.role, member.analysis.vibe)
		);
		statements.push(
			env.DB.prepare('INSERT INTO member_samples (member_id, samples_json) VALUES (?, ?)')
				.bind(memberId, samplesJson)
		);
		for (const badge of badges) {
			statements.push(
				env.DB.prepare('INSERT INTO member_badges (member_id, badge) VALUES (?, ?)').bind(memberId, badge)
			);
		}
	}

	await env.DB.batch(statements);
	return { upload_id: uploadId, source_label: sourceLabel };
}

async function fetchMembersByUpload(env: Env, uploadId: string, query?: string) {
	const baseSql = `
		SELECT
			m.id,
			m.name,
			m.phone_number,
			ms.messages,
			ms.words,
			ms.media,
			ms.links,
			ms.active_days,
			sig.answer_like,
			sig.reply_helpfulness,
			sig.long_msgs,
			sig.unique_words,
			sig.duplicate_count,
			ma.value_score,
			ma.role,
			ma.vibe,
			COALESCE((SELECT json_group_array(badge) FROM member_badges WHERE member_id = m.id), '[]') AS badges_json,
			COALESCE((SELECT samples_json FROM member_samples WHERE member_id = m.id), '[]') AS samples_json
		FROM members m
		JOIN member_stats ms ON ms.member_id = m.id
		JOIN member_signals sig ON sig.member_id = m.id
		JOIN member_analysis ma ON ma.member_id = m.id
		WHERE m.upload_id = ?
	`;

	let sql = baseSql;
	const params: unknown[] = [uploadId];
	if (query && query.trim()) {
		sql += ' AND (m.name LIKE ? OR m.phone_number LIKE ?)';
		const needle = `%${query.trim()}%`;
		params.push(needle, needle);
	}
	sql += ' ORDER BY ma.value_score DESC';

	const { results } = await env.DB.prepare(sql).bind(...params).all<MemberRow>();
	return results.map((row: MemberRow) => ({
		name: row.name,
		phoneNumber: row.phone_number ?? '',
		stats: {
			messages: row.messages,
			words: row.words,
			media: row.media,
			links: row.links,
			active_days: row.active_days,
		},
		signals: {
			answer_like: row.answer_like,
			reply_helpfulness: row.reply_helpfulness,
			long_msgs: row.long_msgs,
			unique_words: row.unique_words,
			duplicate_count: row.duplicate_count,
		},
		analysis: {
			value_score: row.value_score,
			role: row.role,
			vibe: row.vibe,
		},
		badges: JSON.parse(row.badges_json ?? '[]'),
		samples: JSON.parse(row.samples_json ?? '[]'),
	})) as MemberAnalytics[];
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);
		const { pathname } = url;

		if (pathname === '/api/health') {
			return jsonResponse({ ok: true });
		}

		if (pathname === '/api/uploads' && request.method === 'POST') {
			let payload: UploadPayload;
			try {
				payload = await readJson<UploadPayload>(request);
			} catch (err) {
				return badRequest('Invalid JSON payload.');
			}

			if (!payload.members || !Array.isArray(payload.members) || payload.members.length === 0) {
				return badRequest('Payload must include members.');
			}

			const upload = await insertUpload(env, payload);
			return jsonResponse({ upload_id: upload.upload_id, source_label: upload.source_label });
		}

		if (pathname.startsWith('/api/uploads/') && request.method === 'GET') {
			const uploadId = pathname.split('/').pop() || '';
			if (!uploadId) return badRequest('upload_id missing.');
			const members = await fetchMembersByUpload(env, uploadId);
			return jsonResponse({ upload_id: uploadId, members });
		}

		if (pathname === '/api/members' && request.method === 'GET') {
			const uploadId = url.searchParams.get('upload_id') ?? '';
			if (!uploadId) return badRequest('upload_id missing.');
			const query = url.searchParams.get('q') ?? undefined;
			const members = await fetchMembersByUpload(env, uploadId, query);
			return jsonResponse({ upload_id: uploadId, members });
		}

		return notFound();
	},
} satisfies ExportedHandler<Env>;
