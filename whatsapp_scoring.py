from __future__ import annotations

import dataclasses
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


@dataclasses.dataclass(frozen=True)
class ChatMessage:
    timestamp: datetime
    sender: str
    content: str


_LINE_RE = re.compile(
    r"^\[?"
    r"(?P<date>\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})"
    r"(?:,|\s)"
    r"\s*(?P<time>\d{1,2}:\d{2})(?:\s?(?P<ampm>[ap]m|[AP]M))?"
    r"\]?\s-\s"
    r"(?P<body>.*)$"
)
_SENDER_SPLIT_RE = re.compile(r"^(?P<sender>[^:]{1,80}):\s(?P<content>.*)$")

_MEDIA_RE = re.compile(r"<Media omitted>|image omitted|video omitted|GIF omitted", re.IGNORECASE)
_LINK_RE = re.compile(r"https?://", re.IGNORECASE)
_EMOJI_HEAVY_RE = re.compile(r"^[\W_]{1,6}$")
_LAUGH_RE = re.compile(r"\b(lol|lmao|rofl|haha+|hehe+)\b", re.IGNORECASE)
_THANKS_RE = re.compile(r"\b(thanks|thx|ty|thank you)\b", re.IGNORECASE)
_ANSWERY_RE = re.compile(
    r"\b(try|use|fix|fixed|solution|steps|because|install|run|command|works|worked|error|debug)\b",
    re.IGNORECASE,
)
_CODEY_RE = re.compile(r"(```|`[^`]+`|\b(pip|npm|yarn|pnpm|sudo|git)\b|[{}();]=|traceback)", re.IGNORECASE)
_SYSTEM_NAME_SPLIT_RE = re.compile(r",|\sand\s|\s&\s|;")
_SYSTEM_IGNORE = {
    "you",
    "this group",
    "messages to this group",
    "messages in this group",
}


def _parse_timestamp(date_str: str, time_str: str, ampm: str | None) -> datetime:
    date_str = date_str.replace(".", "/").replace("-", "/")
    day_s, month_s, year_s = date_str.split("/")
    day = int(day_s)
    month = int(month_s)
    year = int(year_s)
    if year < 100:
        year += 2000

    hour_s, minute_s = time_str.split(":")
    hour = int(hour_s)
    minute = int(minute_s)

    if ampm:
        ampm = ampm.lower()
        if ampm == "pm" and hour != 12:
            hour += 12
        if ampm == "am" and hour == 12:
            hour = 0

    return datetime(year, month, day, hour, minute)


def parse_whatsapp_export_text(text: str) -> list[ChatMessage]:
    messages: list[ChatMessage] = []
    current: dict[str, Any] | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n")
        match = _LINE_RE.match(line)
        if match:
            if current:
                messages.append(
                    ChatMessage(
                        timestamp=current["timestamp"],
                        sender=current["sender"],
                        content=current["content"].strip(),
                    )
                )
                current = None

            body = match.group("body").strip()
            sender_match = _SENDER_SPLIT_RE.match(body)
            if not sender_match:
                continue  # system message

            timestamp = _parse_timestamp(match.group("date"), match.group("time"), match.group("ampm"))
            current = {
                "timestamp": timestamp,
                "sender": sender_match.group("sender").strip(),
                "content": sender_match.group("content"),
            }
            continue

        if current is not None:
            current["content"] += "\n" + line

    if current:
        messages.append(
            ChatMessage(
                timestamp=current["timestamp"],
                sender=current["sender"],
                content=current["content"].strip(),
            )
        )

    return messages


def parse_whatsapp_export_files(paths: Iterable[str | Path]) -> list[ChatMessage]:
    all_messages: list[ChatMessage] = []
    for path in paths:
        path = Path(path)
        text = path.read_text(encoding="utf-8", errors="replace")
        all_messages.extend(parse_whatsapp_export_text(text))

    all_messages.sort(key=lambda m: m.timestamp)
    return all_messages


def _clean_system_name(raw: str) -> str | None:
    name = raw.strip().strip(".")
    if not name:
        return None
    lower = name.lower()
    if lower in _SYSTEM_IGNORE:
        return None
    if lower.startswith("messages to this group"):
        return None
    return name


def _extract_system_participants(body: str) -> set[str]:
    participants: set[str] = set()
    lower = body.lower()

    if " added " in lower:
        left, right = re.split(r"\sadded\s", body, maxsplit=1, flags=re.IGNORECASE)
        for part in [left, *(_SYSTEM_NAME_SPLIT_RE.split(right))]:
            name = _clean_system_name(part)
            if name:
                participants.add(name)
        return participants

    if " removed " in lower:
        left, right = re.split(r"\sremoved\s", body, maxsplit=1, flags=re.IGNORECASE)
        for part in [left, *(_SYSTEM_NAME_SPLIT_RE.split(right))]:
            name = _clean_system_name(part)
            if name:
                participants.add(name)
        return participants

    if " was removed" in lower:
        name = _clean_system_name(body.split(" was removed", 1)[0])
        if name:
            participants.add(name)
        return participants

    for verb in [" joined", " left", " joined using", " joined from"]:
        if verb in lower:
            name = _clean_system_name(body.split(verb, 1)[0])
            if name:
                participants.add(name)
            return participants

    return participants


def extract_system_participants_from_text(text: str) -> set[str]:
    participants: set[str] = set()
    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n")
        match = _LINE_RE.match(line)
        if not match:
            continue
        body = match.group("body").strip()
        sender_match = _SENDER_SPLIT_RE.match(body)
        if sender_match:
            continue
        participants.update(_extract_system_participants(body))
    return participants


def extract_system_participants_from_files(paths: Iterable[str | Path]) -> set[str]:
    participants: set[str] = set()
    for path in paths:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
        participants.update(extract_system_participants_from_text(text))
    return participants


def _tokenize(content: str) -> list[str]:
    content = content.lower()
    content = re.sub(r"https?://\S+", " ", content)
    content = re.sub(r"[^a-z0-9'\s]", " ", content)
    tokens = [t for t in content.split() if len(t) >= 2]
    return tokens


def _minmax(values: list[float]) -> tuple[float, float]:
    if not values:
        return (0.0, 0.0)
    return (min(values), max(values))

def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = int(round((len(sorted_vals) - 1) * p))
    return sorted_vals[min(max(idx, 0), len(sorted_vals) - 1)]


def _norm(value: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (value - lo) / (hi - lo)))


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def analyze_members(messages: list[ChatMessage], participants: set[str] | None = None) -> list[dict[str, Any]]:
    by_sender: dict[str, list[ChatMessage]] = defaultdict(list)
    for msg in messages:
        by_sender[msg.sender].append(msg)

    question_events: list[tuple[datetime, str]] = []
    for msg in messages:
        if "?" in msg.content:
            question_events.append((msg.timestamp, msg.sender))

    metrics: dict[str, dict[str, Any]] = {}
    for sender, sender_msgs in by_sender.items():
        words = 0
        links = 0
        media = 0
        long_msgs = 0
        question_count = 0
        answer_like = 0
        emoji_like = 0
        laughs = 0
        thanks = 0
        active_days: set[str] = set()
        duplicates = 0
        normalized_contents: list[str] = []
        token_counter: Counter[str] = Counter()

        for msg in sender_msgs:
            content = msg.content.strip()
            active_days.add(msg.timestamp.strftime("%Y-%m-%d"))

            if _MEDIA_RE.search(content):
                media += 1
            if _LINK_RE.search(content):
                links += 1
            if "?" in content:
                question_count += 1

            tokens = _tokenize(content)
            words += len(tokens)
            token_counter.update(tokens)

            if len(tokens) >= 20 or "\n" in content:
                long_msgs += 1

            if _EMOJI_HEAVY_RE.match(content):
                emoji_like += 1
            if _LAUGH_RE.search(content):
                laughs += 1
            if _THANKS_RE.search(content):
                thanks += 1

            answeriness = 0
            if len(tokens) >= 12:
                answeriness += 1
            if _ANSWERY_RE.search(content):
                answeriness += 1
            if _CODEY_RE.search(content):
                answeriness += 1
            if _LINK_RE.search(content) and len(tokens) >= 6:
                answeriness += 1
            if answeriness >= 2:
                answer_like += 1

            normalized = re.sub(r"\s+", " ", content.lower()).strip()
            normalized_contents.append(normalized)

        content_counts = Counter(normalized_contents)
        duplicates = sum(max(0, c - 1) for c in content_counts.values())

        unique_words = len(token_counter)
        msg_count = len(sender_msgs)
        short_ratio = (emoji_like / msg_count) if msg_count else 0.0
        avg_words = (words / msg_count) if msg_count else 0.0

        metrics[sender] = {
            "msg_count": msg_count,
            "word_count": words,
            "unique_words": unique_words,
            "long_msgs": long_msgs,
            "question_count": question_count,
            "answer_like": answer_like,
            "emoji_like": emoji_like,
            "laughs": laughs,
            "thanks": thanks,
            "link_count": links,
            "media_count": media,
            "active_days": len(active_days),
            "duplicate_count": duplicates,
            "short_ratio": short_ratio,
            "avg_words": avg_words,
            "messages_sample": [m.content for m in sender_msgs[-40:]],
        }

    participants = participants or set()
    for ghost in sorted(participants - set(metrics.keys())):
        metrics[ghost] = {
            "msg_count": 0,
            "word_count": 0,
            "unique_words": 0,
            "long_msgs": 0,
            "question_count": 0,
            "answer_like": 0,
            "emoji_like": 0,
            "laughs": 0,
            "thanks": 0,
            "link_count": 0,
            "media_count": 0,
            "active_days": 0,
            "duplicate_count": 0,
            "short_ratio": 0.0,
            "avg_words": 0.0,
            "messages_sample": [],
        }

    # credit answers that come soon after someone else's question
    reply_helpfulness: dict[str, int] = defaultdict(int)
    if messages:
        q_idx = 0
        for msg in messages:
            while q_idx < len(question_events) and question_events[q_idx][0] < msg.timestamp - timedelta(minutes=10):
                q_idx += 1
            for i in range(q_idx, len(question_events)):
                q_time, q_sender = question_events[i]
                if q_time > msg.timestamp:
                    break
                if q_sender == msg.sender:
                    continue
                if msg.timestamp - q_time > timedelta(minutes=10):
                    continue
                if metrics[msg.sender]["answer_like"] <= 0:
                    continue
                reply_helpfulness[msg.sender] += 1
                break

    for sender, count in reply_helpfulness.items():
        metrics[sender]["reply_helpfulness"] = count
    for sender in metrics:
        metrics[sender].setdefault("reply_helpfulness", 0)

    # normalize across members
    def gather(key: str) -> list[float]:
        return [float(m[key]) for m in metrics.values()]

    ranges = {k: _minmax(gather(k)) for k in [
        "answer_like",
        "reply_helpfulness",
        "long_msgs",
        "link_count",
        "unique_words",
        "active_days",
        "duplicate_count",
        "short_ratio",
    ]}

    thresholds = {
        "answer_like": max(2, _percentile(gather("answer_like"), 0.85)),
        "reply_helpfulness": max(1, _percentile(gather("reply_helpfulness"), 0.85)),
        "link_count": max(2, _percentile(gather("link_count"), 0.9)),
        "laughs": max(1, _percentile(gather("laughs"), 0.9)),
        "long_msgs": max(2, _percentile(gather("long_msgs"), 0.9)),
        "question_count": max(2, _percentile(gather("question_count"), 0.9)),
    }

    members: list[dict[str, Any]] = []
    for sender, m in metrics.items():
        helpful = (
            0.65 * _norm(m["answer_like"], *ranges["answer_like"])
            + 0.35 * _norm(m["reply_helpfulness"], *ranges["reply_helpfulness"])
        )
        substance = (
            0.45 * _norm(m["long_msgs"], *ranges["long_msgs"])
            + 0.35 * _norm(m["unique_words"], *ranges["unique_words"])
            + 0.20 * _norm(m["link_count"], *ranges["link_count"])
        )
        consistency = _norm(m["active_days"], *ranges["active_days"])
        penalty = (
            0.60 * _norm(m["duplicate_count"], *ranges["duplicate_count"])
            + 0.40 * _norm(m["short_ratio"], *ranges["short_ratio"])
        )

        raw = (2.2 * helpful) + (1.4 * substance) + (0.7 * consistency) - (1.8 * penalty)
        score_0_1 = 1.0 / (1.0 + math.exp(-3.0 * (raw - 0.9)))  # squash
        value_score = 1 + 9 * score_0_1
        value_score = round(_clamp(value_score, 1, 10), 1)

        role = _role_from_metrics(m, value_score, thresholds)
        vibe = _vibe_from_metrics(m, role)
        badges = _badges_from_metrics(m, value_score)

        members.append(
            {
                "name": sender,
                "phoneNumber": sender,
                "stats": {
                    "messages": m["msg_count"],
                    "words": m["word_count"],
                    "media": m["media_count"],
                    "links": m["link_count"],
                    "active_days": m["active_days"],
                },
                "signals": {
                    "answer_like": m["answer_like"],
                    "reply_helpfulness": m["reply_helpfulness"],
                    "long_msgs": m["long_msgs"],
                    "unique_words": m["unique_words"],
                    "duplicate_count": m["duplicate_count"],
                },
                "analysis": {
                    "value_score": value_score,
                    "role": role,
                    "vibe": vibe,
                },
                "badges": badges,
                "samples": m["messages_sample"],
            }
        )

    members.sort(key=lambda x: x["analysis"]["value_score"], reverse=True)
    return members


def _role_from_metrics(m: dict[str, Any], value_score: float, thresholds: dict[str, float]) -> str:
    if m["msg_count"] <= 2:
        return "Ghost"
    if m["answer_like"] >= thresholds["answer_like"] or m["reply_helpfulness"] >= thresholds["reply_helpfulness"]:
        return "Problem Solver"
    if m["link_count"] >= thresholds["link_count"]:
        return "Curator"
    if m["laughs"] >= thresholds["laughs"]:
        return "Comedian"
    if m["question_count"] >= thresholds["question_count"] and value_score < 7:
        return "Asker"
    if m["long_msgs"] >= thresholds["long_msgs"]:
        return "Deep Writer"
    return "Member"


def _vibe_from_metrics(m: dict[str, Any], role: str) -> str:
    if role == "Ghost":
        return "Mostly lurking — rare sightings."
    if role == "Problem Solver":
        return "Drops practical answers that move the chat forward."
    if role == "Curator":
        return "Shares links and resources people actually use."
    if role == "Comedian":
        return "Keeps the vibe light and the chat alive."
    if role == "Deep Writer":
        return "Writes thoughtful messages with real substance."
    if role == "Asker":
        return "Asks a lot — sparks threads and pulls people in."
    if m["duplicate_count"] >= 5:
        return "Occasionally spammy, but still part of the lore."
    return "Consistent presence with a steady contribution."


def _badges_from_metrics(m: dict[str, Any], value_score: float) -> list[str]:
    badges: list[str] = []
    if value_score >= 8.5:
        badges.append("MVP")
    if m["reply_helpfulness"] >= 6:
        badges.append("Helper")
    if m["link_count"] >= 15:
        badges.append("Curator")
    if m["long_msgs"] >= 10:
        badges.append("Deep Writer")
    if m["active_days"] >= 40:
        badges.append("Regular")
    if m["laughs"] >= 8:
        badges.append("Comedian")
    if m["media_count"] >= 30:
        badges.append("Media Mogul")
    if m["duplicate_count"] >= 8:
        badges.append("Echo Chamber")
    return badges
