import { VirtualClip } from "../../shared/types";

export interface TranscriptPassage {
  id: string;
  startSec: number;
  endSec: number;
  timestampLabel: string;
  text: string;
}

/**
 * Formats a duration in seconds into MM:SS or HH:MM:SS.
 */
export function formatTimestamp(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Parses timestamp string e.g. "01:24" or "[01:24]" or "01:02:15" into seconds.
 */
export function parseTimestamp(label: string): number {
  const cleaned = label.replace(/[\[\]]/g, "").trim();
  const parts = cleaned.split(":").map((p) => Number(p));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

/**
 * Extracts structured timestamped passages from a VirtualClip.
 * Priority:
 * 1. transcriptionChunks (from Whisper / sidecar)
 * 2. embedded timestamps in editedTranscript / fullTranscription e.g. [01:24] text
 * 3. paragraphs split across clip duration
 */
export function extractTranscriptPassages(clip: VirtualClip): TranscriptPassage[] {
  const duration = Math.max(1, clip.endTimeSeconds - clip.startTimeSeconds);

  // 1. If transcriptionChunks are available with valid timestamps, group or format them into passages
  if (clip.transcriptionChunks && clip.transcriptionChunks.length > 0) {
    const passages: TranscriptPassage[] = [];
    let currentText = "";
    let currentStart = -1;
    let currentEnd = -1;

    for (let i = 0; i < clip.transcriptionChunks.length; i++) {
      const chunk = clip.transcriptionChunks[i];
      const text = (chunk.text || "").trim();
      if (!text) continue;

      const chunkStart = chunk.timestamp && typeof chunk.timestamp[0] === "number" ? chunk.timestamp[0] : 0;
      const chunkEnd =
        chunk.timestamp && typeof chunk.timestamp[1] === "number" ? chunk.timestamp[1] : chunkStart + 5;

      if (currentStart === -1) {
        currentStart = chunkStart;
        currentEnd = chunkEnd;
        currentText = text;
      } else if (currentText.length < 180 && chunkStart - currentEnd < 4) {
        currentText += " " + text;
        currentEnd = chunkEnd;
      } else {
        passages.push({
          id: `passage-${passages.length}`,
          startSec: currentStart,
          endSec: currentEnd,
          timestampLabel: formatTimestamp(currentStart),
          text: currentText,
        });
        currentStart = chunkStart;
        currentEnd = chunkEnd;
        currentText = text;
      }
    }

    if (currentText) {
      passages.push({
        id: `passage-${passages.length}`,
        startSec: currentStart,
        endSec: currentEnd,
        timestampLabel: formatTimestamp(currentStart),
        text: currentText,
      });
    }

    if (passages.length > 0) {
      return passages;
    }
  }

  // 2. Fall back to editedTranscript, fullTranscription, or transcription text
  const rawText = (clip.editedTranscript || clip.fullTranscription || clip.transcription || "").trim();
  if (!rawText) {
    return [];
  }

  // Check if text has embedded timestamps like [01:24] or 01:24
  const timestampRegex = /(?:^|\n)\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/g;
  const matches = Array.from(rawText.matchAll(timestampRegex));

  if (matches.length > 1) {
    const passages: TranscriptPassage[] = [];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const timeStr = match[1];
      const startSec = parseTimestamp(timeStr);
      const textStartIndex = match.index + match[0].length;
      const textEndIndex = i < matches.length - 1 ? matches[i + 1].index : rawText.length;
      const passageText = rawText.slice(textStartIndex, textEndIndex).trim();
      const nextStartSec = i < matches.length - 1 ? parseTimestamp(matches[i + 1][1]) : duration;

      passages.push({
        id: `passage-${i}`,
        startSec,
        endSec: Math.max(startSec + 2, nextStartSec),
        timestampLabel: formatTimestamp(startSec),
        text: passageText,
      });
    }
    return passages;
  }

  // Split by double newline or single newline paragraphs
  const paragraphs = rawText
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const timePerParagraph = duration / paragraphs.length;
  return paragraphs.map((para, idx) => {
    const startSec = Math.floor(idx * timePerParagraph);
    const endSec = Math.floor((idx + 1) * timePerParagraph);
    return {
      id: `passage-${idx}`,
      startSec,
      endSec,
      timestampLabel: formatTimestamp(startSec),
      text: para,
    };
  });
}

/**
 * Finds the currently active passage based on playback time in seconds.
 */
export function findActivePassage(
  passages: TranscriptPassage[],
  currentTimeSec: number
): TranscriptPassage | null {
  if (!passages || passages.length === 0) return null;

  for (const p of passages) {
    if (currentTimeSec >= p.startSec && currentTimeSec < p.endSec) {
      return p;
    }
  }

  let latestPreceding: TranscriptPassage | null = null;
  for (const p of passages) {
    if (p.startSec <= currentTimeSec) {
      latestPreceding = p;
    }
  }

  return latestPreceding || passages[0];
}

/**
 * Formats transcript passages into clean plain text for clipboard or export.
 */
export function formatTranscriptAsPlainText(
  passages: TranscriptPassage[],
  includeTimestamps = true
): string {
  if (!passages || passages.length === 0) return "";
  return passages
    .map((p) => (includeTimestamps ? `[${p.timestampLabel}] ${p.text}` : p.text))
    .join("\n\n");
}
