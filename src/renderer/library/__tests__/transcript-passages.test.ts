import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  parseTimestamp,
  extractTranscriptPassages,
  findActivePassage,
  formatTranscriptAsPlainText,
} from "../transcript-passages";
import { VirtualClip } from "../../../shared/types";

describe("transcript-passages", () => {
  describe("formatTimestamp", () => {
    it("formats minutes and seconds", () => {
      expect(formatTimestamp(0)).toBe("00:00");
      expect(formatTimestamp(5)).toBe("00:05");
      expect(formatTimestamp(84)).toBe("01:24");
      expect(formatTimestamp(599)).toBe("09:59");
    });

    it("formats hours, minutes, and seconds when >= 3600", () => {
      expect(formatTimestamp(3600)).toBe("01:00:00");
      expect(formatTimestamp(3735)).toBe("01:02:15");
    });
  });

  describe("parseTimestamp", () => {
    it("parses MM:SS format", () => {
      expect(parseTimestamp("01:24")).toBe(84);
      expect(parseTimestamp("[01:24]")).toBe(84);
      expect(parseTimestamp("00:00")).toBe(0);
    });

    it("parses HH:MM:SS format", () => {
      expect(parseTimestamp("01:02:15")).toBe(3735);
      expect(parseTimestamp("[01:02:15]")).toBe(3735);
    });
  });

  describe("extractTranscriptPassages", () => {
    const baseClip: VirtualClip = {
      id: "clip-1",
      parentFileId: "file-1",
      title: "Strategy Session",
      startTimeSeconds: 0,
      endTimeSeconds: 300,
      category: "meeting",
      userTags: [],
      classificationConfidence: 0.95,
      classificationSource: "whisper_local",
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it("extracts from transcriptionChunks", () => {
      const clip: VirtualClip = {
        ...baseClip,
        transcriptionChunks: [
          { text: "We started by reviewing the previous session.", timestamp: [0, 4.5] },
          { text: "And the questions we wanted to explore today.", timestamp: [4.8, 9.0] },
          { text: "Here is the key decision on onboarding.", timestamp: [84.0, 92.0] },
        ],
      };

      const passages = extractTranscriptPassages(clip);
      expect(passages.length).toBeGreaterThanOrEqual(2);
      expect(passages[0].timestampLabel).toBe("00:00");
      expect(passages[passages.length - 1].timestampLabel).toBe("01:24");
      expect(passages[passages.length - 1].text).toContain("onboarding");
    });

    it("extracts from text with embedded timestamps", () => {
      const clip: VirtualClip = {
        ...baseClip,
        fullTranscription: "[00:00] Intro to the project.\n\n[01:24] Key architecture decisions.\n\n[03:00] Next steps.",
      };

      const passages = extractTranscriptPassages(clip);
      expect(passages.length).toBe(3);
      expect(passages[0].timestampLabel).toBe("00:00");
      expect(passages[0].text).toBe("Intro to the project.");
      expect(passages[1].timestampLabel).toBe("01:24");
      expect(passages[1].text).toBe("Key architecture decisions.");
      expect(passages[2].timestampLabel).toBe("03:00");
    });

    it("extracts from plain paragraphs when no chunks or timestamps exist", () => {
      const clip: VirtualClip = {
        ...baseClip,
        transcription: "First paragraph discussing the overview.\n\nSecond paragraph summarizing conclusions.",
      };

      const passages = extractTranscriptPassages(clip);
      expect(passages.length).toBe(2);
      expect(passages[0].timestampLabel).toBe("00:00");
      expect(passages[1].timestampLabel).toBe("02:30"); // 300s / 2
      expect(passages[0].text).toContain("First paragraph");
    });

    it("returns empty array for empty transcript", () => {
      const passages = extractTranscriptPassages(baseClip);
      expect(passages).toEqual([]);
    });
  });

  describe("findActivePassage", () => {
    const passages = [
      { id: "p0", startSec: 0, endSec: 60, timestampLabel: "00:00", text: "Part 1" },
      { id: "p1", startSec: 60, endSec: 150, timestampLabel: "01:00", text: "Part 2" },
      { id: "p2", startSec: 150, endSec: 300, timestampLabel: "02:30", text: "Part 3" },
    ];

    it("returns exact match", () => {
      const active = findActivePassage(passages, 84);
      expect(active?.id).toBe("p1");
    });

    it("returns first passage if before start", () => {
      const active = findActivePassage(passages, 0);
      expect(active?.id).toBe("p0");
    });

    it("returns last passage if beyond range", () => {
      const active = findActivePassage(passages, 350);
      expect(active?.id).toBe("p2");
    });
  });

  describe("formatTranscriptAsPlainText", () => {
    const passages = [
      { id: "p0", startSec: 0, endSec: 30, timestampLabel: "00:00", text: "Hello" },
      { id: "p1", startSec: 30, endSec: 60, timestampLabel: "00:30", text: "World" },
    ];

    it("formats with timestamps", () => {
      const text = formatTranscriptAsPlainText(passages, true);
      expect(text).toBe("[00:00] Hello\n\n[00:30] World");
    });

    it("formats without timestamps", () => {
      const text = formatTranscriptAsPlainText(passages, false);
      expect(text).toBe("Hello\n\nWorld");
    });
  });
});
