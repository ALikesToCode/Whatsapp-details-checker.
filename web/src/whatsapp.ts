export type ChatMessage = {
  timestamp: Date;
  sender: string;
  content: string;
};

const LINE_RE =
  /^\[?(?<date>\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})(?:,|\s)\s*(?<time>\d{1,2}:\d{2})(?:\s?(?<ampm>[ap]m|[AP]M))?\]?\s-\s(?<body>.*)$/;
const SENDER_SPLIT_RE = /^(?<sender>[^:]{1,80}):\s(?<content>.*)$/;

const MEDIA_RE = /<Media omitted>|image omitted|video omitted|GIF omitted/i;
const LINK_RE = /https?:\/\//i;
const EMOJI_HEAVY_RE = /^[\W_]{1,6}$/;
const LAUGH_RE = /\b(lol|lmao|rofl|haha+|hehe+)\b/i;
const THANKS_RE = /\b(thanks|thx|ty|thank you)\b/i;
const ANSWERY_RE = /\b(try|use|fix|fixed|solution|steps|because|install|run|command|works|worked|error|debug)\b/i;
const CODEY_RE = /(```|`[^`]+`|\b(pip|npm|yarn|pnpm|sudo|git)\b|[{}();]=|traceback)/i;
const SYSTEM_NAME_SPLIT_RE = /,|\sand\s|\s&\s|;/i;
const SYSTEM_IGNORE = new Set(['you', 'this group', 'messages to this group', 'messages in this group']);

function parseTimestamp(dateStr: string, timeStr: string, ampm?: string): Date {
  const normalized = dateStr.replaceAll('.', '/').replaceAll('-', '/');
  const [dayS, monthS, yearS] = normalized.split('/');
  const day = Number(dayS);
  const month = Number(monthS);
  let year = Number(yearS);
  if (year < 100) year += 2000;

  const [hourS, minuteS] = timeStr.split(':');
  let hour = Number(hourS);
  const minute = Number(minuteS);

  if (ampm) {
    const lower = ampm.toLowerCase();
    if (lower === 'pm' && hour !== 12) hour += 12;
    if (lower === 'am' && hour === 12) hour = 0;
  }

  return new Date(year, month - 1, day, hour, minute);
}

export function parseWhatsAppExportText(text: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let current: ChatMessage | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine;
    const m = LINE_RE.exec(line);
    if (m?.groups) {
      if (current) messages.push({ ...current, content: current.content.trim() });
      current = null;

      const body = m.groups.body.trim();
      const senderM = SENDER_SPLIT_RE.exec(body);
      if (!senderM?.groups) continue; // system message

      current = {
        timestamp: parseTimestamp(m.groups.date, m.groups.time, m.groups.ampm),
        sender: senderM.groups.sender.trim(),
        content: senderM.groups.content,
      };
      continue;
    }

    if (current) current.content += `\n${line}`;
  }

  if (current) messages.push({ ...current, content: current.content.trim() });
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

function cleanSystemName(raw: string): string | null {
  const name = raw.trim().replace(/\.$/, '');
  if (!name) return null;
  const lower = name.toLowerCase();
  if (SYSTEM_IGNORE.has(lower)) return null;
  if (lower.startsWith('messages to this group')) return null;
  return name;
}

function extractSystemParticipants(body: string): string[] {
  const participants: string[] = [];
  const lower = body.toLowerCase();

  if (lower.includes(' added ')) {
    const parts = body.split(/ added /i);
    const left = parts[0] ?? '';
    const right = parts[1] ?? '';
    const list = [left, ...right.split(SYSTEM_NAME_SPLIT_RE)];
    for (const part of list) {
      const name = cleanSystemName(part);
      if (name) participants.push(name);
    }
    return participants;
  }

  if (lower.includes(' removed ')) {
    const parts = body.split(/ removed /i);
    const left = parts[0] ?? '';
    const right = parts[1] ?? '';
    const list = [left, ...right.split(SYSTEM_NAME_SPLIT_RE)];
    for (const part of list) {
      const name = cleanSystemName(part);
      if (name) participants.push(name);
    }
    return participants;
  }

  if (lower.includes(' was removed')) {
    const name = cleanSystemName(body.split(/ was removed/i)[0] ?? '');
    if (name) participants.push(name);
    return participants;
  }

  for (const verb of [' joined', ' left', ' joined using', ' joined from']) {
    if (lower.includes(verb)) {
      const name = cleanSystemName(body.split(new RegExp(verb, 'i'))[0] ?? '');
      if (name) participants.push(name);
      return participants;
    }
  }

  return participants;
}

function extractSystemParticipantsFromText(text: string): Set<string> {
  const participants = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(rawLine);
    if (!m?.groups) continue;
    const body = m.groups.body.trim();
    if (SENDER_SPLIT_RE.exec(body)) continue;
    for (const name of extractSystemParticipants(body)) participants.add(name);
  }
  return participants;
}

function tokenize(content: string): string[] {
  const lowered = content.toLowerCase();
  const noLinks = lowered.replaceAll(/https?:\/\/\S+/g, ' ');
  const normalized = noLinks.replaceAll(/[^a-z0-9'\s]/g, ' ');
  return normalized.split(/\s+/).filter((t) => t.length >= 2);
}

function minmax(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.round((sorted.length - 1) * p);
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

function norm(value: number, [lo, hi]: [number, number]): number {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export type MemberAnalytics = {
  name: string;
  phoneNumber: string;
  stats: { messages: number; words: number; media: number; links: number; active_days: number };
  signals?: { answer_like: number; reply_helpfulness: number; long_msgs: number; unique_words: number; duplicate_count: number };
  analysis: { value_score: number; role: string; vibe: string };
  badges: string[];
  samples?: string[];
};

export function analyzeWhatsAppMessages(messages: ChatMessage[]): MemberAnalytics[] {
  const bySender = new Map<string, ChatMessage[]>();
  for (const msg of messages) {
    const list = bySender.get(msg.sender) ?? [];
    list.push(msg);
    bySender.set(msg.sender, list);
  }

  const questionEvents: Array<{ at: number; sender: string }> = [];
  for (const msg of messages) if (msg.content.includes('?')) questionEvents.push({ at: msg.timestamp.getTime(), sender: msg.sender });

  const metrics = new Map<string, any>();
  for (const [sender, senderMsgs] of bySender.entries()) {
    let words = 0;
    let links = 0;
    let media = 0;
    let longMsgs = 0;
    let questionCount = 0;
    let answerLike = 0;
    let emojiLike = 0;
    let laughs = 0;
    let thanks = 0;
    const activeDays = new Set<string>();
    const normalizedContents: string[] = [];
    const tokens = new Set<string>();

    for (const msg of senderMsgs) {
      const content = msg.content.trim();
      activeDays.add(new Date(msg.timestamp).toISOString().slice(0, 10));
      if (MEDIA_RE.test(content)) media += 1;
      if (LINK_RE.test(content)) links += 1;
      if (content.includes('?')) questionCount += 1;

      const toks = tokenize(content);
      words += toks.length;
      for (const t of toks) tokens.add(t);
      if (toks.length >= 20 || content.includes('\n')) longMsgs += 1;

      if (EMOJI_HEAVY_RE.test(content)) emojiLike += 1;
      if (LAUGH_RE.test(content)) laughs += 1;
      if (THANKS_RE.test(content)) thanks += 1;

      let answeriness = 0;
      if (toks.length >= 12) answeriness += 1;
      if (ANSWERY_RE.test(content)) answeriness += 1;
      if (CODEY_RE.test(content)) answeriness += 1;
      if (LINK_RE.test(content) && toks.length >= 6) answeriness += 1;
      if (answeriness >= 2) answerLike += 1;

      normalizedContents.push(content.toLowerCase().replaceAll(/\s+/g, ' ').trim());
    }

    const counts = new Map<string, number>();
    for (const c of normalizedContents) counts.set(c, (counts.get(c) ?? 0) + 1);
    let duplicates = 0;
    for (const c of counts.values()) if (c > 1) duplicates += c - 1;

    const msgCount = senderMsgs.length;
    metrics.set(sender, {
      msg_count: msgCount,
      word_count: words,
      unique_words: tokens.size,
      long_msgs: longMsgs,
      question_count: questionCount,
      answer_like: answerLike,
      emoji_like: emojiLike,
      laughs,
      thanks,
      link_count: links,
      media_count: media,
      active_days: activeDays.size,
      duplicate_count: duplicates,
      short_ratio: msgCount ? emojiLike / msgCount : 0,
      samples: senderMsgs.slice(-40).map((m) => m.content),
    });
  }

  // credit answers soon after others' questions
  const replyHelp = new Map<string, number>();
  const windowMs = 10 * 60 * 1000;
  for (const msg of messages) {
    const msgAt = msg.timestamp.getTime();
    for (let i = questionEvents.length - 1; i >= 0; i -= 1) {
      const q = questionEvents[i];
      if (q.at > msgAt) continue;
      if (msgAt - q.at > windowMs) break;
      if (q.sender === msg.sender) continue;
      const m = metrics.get(msg.sender);
      if (!m) continue;
      if (m.answer_like <= 0) continue;
      replyHelp.set(msg.sender, (replyHelp.get(msg.sender) ?? 0) + 1);
      break;
    }
  }

  for (const [sender, m] of metrics.entries()) m.reply_helpfulness = replyHelp.get(sender) ?? 0;

  const thresholds = {
    answer_like: Math.max(2, percentile(Array.from(metrics.values()).map((m) => m.answer_like), 0.85)),
    reply_helpfulness: Math.max(1, percentile(Array.from(metrics.values()).map((m) => m.reply_helpfulness), 0.85)),
    link_count: Math.max(2, percentile(Array.from(metrics.values()).map((m) => m.link_count), 0.9)),
    laughs: Math.max(1, percentile(Array.from(metrics.values()).map((m) => m.laughs), 0.9)),
    long_msgs: Math.max(2, percentile(Array.from(metrics.values()).map((m) => m.long_msgs), 0.9)),
    question_count: Math.max(2, percentile(Array.from(metrics.values()).map((m) => m.question_count), 0.9)),
  };

  const keys = [
    'answer_like',
    'reply_helpfulness',
    'long_msgs',
    'link_count',
    'unique_words',
    'active_days',
    'duplicate_count',
    'short_ratio',
  ] as const;
  const ranges = new Map<string, [number, number]>();
  for (const k of keys) ranges.set(k, minmax(Array.from(metrics.values()).map((m) => Number(m[k] ?? 0))));

  const members: MemberAnalytics[] = [];
  for (const [sender, m] of metrics.entries()) {
    const helpful =
      0.65 * norm(m.answer_like, ranges.get('answer_like')!) + 0.35 * norm(m.reply_helpfulness, ranges.get('reply_helpfulness')!);
    const substance =
      0.45 * norm(m.long_msgs, ranges.get('long_msgs')!) +
      0.35 * norm(m.unique_words, ranges.get('unique_words')!) +
      0.2 * norm(m.link_count, ranges.get('link_count')!);
    const consistency = norm(m.active_days, ranges.get('active_days')!);
    const penalty =
      0.6 * norm(m.duplicate_count, ranges.get('duplicate_count')!) + 0.4 * norm(m.short_ratio, ranges.get('short_ratio')!);

    const raw = 2.2 * helpful + 1.4 * substance + 0.7 * consistency - 1.8 * penalty;
    const score01 = 1 / (1 + Math.exp(-3 * (raw - 0.9)));
    const valueScore = Math.round(clamp(1 + 9 * score01, 1, 10) * 10) / 10;

    const role = roleFrom(m, valueScore, thresholds);
    const vibe = vibeFrom(m, role);
    const badges = badgesFrom(m, valueScore);

    members.push({
      name: sender,
      phoneNumber: sender,
      stats: { messages: m.msg_count, words: m.word_count, media: m.media_count, links: m.link_count, active_days: m.active_days },
      signals: {
        answer_like: m.answer_like,
        reply_helpfulness: m.reply_helpfulness,
        long_msgs: m.long_msgs,
        unique_words: m.unique_words,
        duplicate_count: m.duplicate_count,
      },
      analysis: { value_score: valueScore, role, vibe },
      badges,
      samples: m.samples,
    });
  }

  members.sort((a, b) => b.analysis.value_score - a.analysis.value_score);
  return members;
}

export function analyzeWhatsAppExportTexts(texts: string[]): MemberAnalytics[] {
  const all: ChatMessage[] = [];
  const participants = new Set<string>();
  for (const t of texts) {
    all.push(...parseWhatsAppExportText(t));
    for (const name of extractSystemParticipantsFromText(t)) participants.add(name);
  }
  all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const members = analyzeWhatsAppMessages(all);

  const existing = new Set(members.map((m) => m.name));
  for (const name of participants) {
    if (existing.has(name)) continue;
    members.push({
      name,
      phoneNumber: name,
      stats: { messages: 0, words: 0, media: 0, links: 0, active_days: 0 },
      analysis: { value_score: 1, role: 'Ghost', vibe: 'No messages in the export.' },
      badges: [],
      samples: [],
    });
  }

  members.sort((a, b) => b.analysis.value_score - a.analysis.value_score);
  return members;
}

function roleFrom(m: any, valueScore: number, thresholds: any): string {
  if (m.msg_count <= 2) return 'Ghost';
  if (m.answer_like >= thresholds.answer_like || m.reply_helpfulness >= thresholds.reply_helpfulness) return 'Problem Solver';
  if (m.link_count >= thresholds.link_count) return 'Curator';
  if (m.laughs >= thresholds.laughs) return 'Comedian';
  if (m.question_count >= thresholds.question_count && valueScore < 7) return 'Asker';
  if (m.long_msgs >= thresholds.long_msgs) return 'Deep Writer';
  return 'Member';
}

function vibeFrom(m: any, role: string): string {
  if (role === 'Ghost') return 'Mostly lurking — rare sightings.';
  if (role === 'Problem Solver') return 'Drops practical answers that move the chat forward.';
  if (role === 'Curator') return 'Shares links and resources people actually use.';
  if (role === 'Comedian') return 'Keeps the vibe light and the chat alive.';
  if (role === 'Deep Writer') return 'Writes thoughtful messages with real substance.';
  if (role === 'Asker') return 'Asks a lot — sparks threads and pulls people in.';
  if (m.duplicate_count >= 5) return 'Occasionally spammy, but still part of the lore.';
  return 'Consistent presence with a steady contribution.';
}

function badgesFrom(m: any, valueScore: number): string[] {
  const badges: string[] = [];
  if (valueScore >= 8.5) badges.push('MVP');
  if (m.reply_helpfulness >= 6) badges.push('Helper');
  if (m.link_count >= 15) badges.push('Curator');
  if (m.long_msgs >= 10) badges.push('Deep Writer');
  if (m.active_days >= 40) badges.push('Regular');
  if (m.laughs >= 8) badges.push('Comedian');
  if (m.media_count >= 30) badges.push('Media Mogul');
  if (m.duplicate_count >= 8) badges.push('Echo Chamber');
  return badges;
}
