import { VirtualClip } from "../../shared/types";
import { extractTranscriptPassages, formatTimestamp } from "./transcript-passages";

export type SearchScope = "all" | "transcripts" | "titles";

export interface SearchPassageHit {
  passageId: string;
  startSec: number;
  endSec: number;
  timestampLabel: string;
  snippet: string;
  text: string;
}

export interface SearchResultItem {
  clip: VirtualClip;
  matchedInTitle: boolean;
  matchedInTags: boolean;
  matchedInNotes: boolean;
  passageHits: SearchPassageHit[];
  score: number;
}

/**
 * Escapes regex special characters safely.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^$\{}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts a contextual snippet around matching words in a text passage.
 */
export function extractSnippet(text: string, query: string, maxLength = 180): string {
  const q = query.trim().toLowerCase();
  if (!q) return text.slice(0, maxLength);

  const lower = text.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) {
    return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + q.length + 80);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/**
 * Lexical search engine indexing titles, tags, notes, collections, and transcript passages.
 */
export function searchLibrary(
  clips: VirtualClip[],
  query: string,
  scope: SearchScope = "all"
): SearchResultItem[] {
  const trimmed = (query || "").trim().toLowerCase();
  if (!trimmed) return [];

  const terms = trimmed.split(/\s+/).filter(Boolean);
  const results: SearchResultItem[] = [];

  for (const clip of clips) {
    if (clip.isExcluded) continue;

    const titleLower = (clip.title || "").toLowerCase();
    const tagsLower = (clip.userTags || []).join(" ").toLowerCase();
    const notesLower = (clip.notes || "").toLowerCase();
    const colLower = (clip.collections || []).join(" ").toLowerCase();

    let matchedInTitle = false;
    let matchedInTags = false;
    let matchedInNotes = false;
    let score = 0;

    if (scope === "all" || scope === "titles") {
      if (titleLower.includes(trimmed)) {
        matchedInTitle = true;
        score += 100;
      } else if (terms.every((t) => titleLower.includes(t))) {
        matchedInTitle = true;
        score += 60;
      }

      if (tagsLower.includes(trimmed) || terms.some((t) => tagsLower.includes(t))) {
        matchedInTags = true;
        score += 40;
      }

      if (colLower.includes(trimmed)) {
        score += 30;
      }

      if (notesLower.includes(trimmed)) {
        matchedInNotes = true;
        score += 20;
      }
    }

    const passageHits: SearchPassageHit[] = [];

    if (scope === "all" || scope === "transcripts") {
      const passages = extractTranscriptPassages(clip);
      for (const p of passages) {
        const pLower = p.text.toLowerCase();
        if (pLower.includes(trimmed) || terms.every((t) => pLower.includes(t))) {
          passageHits.push({
            passageId: p.id,
            startSec: p.startSec,
            endSec: p.endSec,
            timestampLabel: p.timestampLabel,
            snippet: extractSnippet(p.text, trimmed),
            text: p.text,
          });
          score += 50;
        }
      }
    }

    if (matchedInTitle || matchedInTags || matchedInNotes || passageHits.length > 0) {
      results.push({
        clip,
        matchedInTitle,
        matchedInTags,
        matchedInNotes,
        passageHits,
        score,
      });
    }
  }

  // Sort by relevance score descending, then by creation date descending
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.clip.createdAt).getTime() - new Date(a.clip.createdAt).getTime();
  });
}
