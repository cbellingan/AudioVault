import { describe, it, expect } from "vitest";
import { searchLibrary, escapeRegex, extractSnippet } from "../search-engine";
import { VirtualClip } from "../../../shared/types";

describe("search-engine", () => {
  const clips: VirtualClip[] = [
    {
      id: "clip-1",
      parentFileId: "file-1",
      title: "Quarterly Planning & Strategy",
      startTimeSeconds: 0,
      endTimeSeconds: 300,
      category: "meeting",
      userTags: ["Executive", "Q3"],
      classificationConfidence: 0.95,
      classificationSource: "whisper_local",
      isExcluded: false,
      fullTranscription: "[00:00] Welcome everyone to the quarterly review.\n\n[01:24] Our primary focus is customer onboarding and self-serve workflows.\n\n[03:15] Let us wrap up the next steps.",
      createdAt: "2026-09-01T10:00:00Z",
      updatedAt: "2026-09-01T10:00:00Z",
    },
    {
      id: "clip-2",
      parentFileId: "file-2",
      title: "Acoustic Warmup Session (Take 1)",
      startTimeSeconds: 0,
      endTimeSeconds: 120,
      category: "music",
      userTags: ["Guitar", "Fingerpicking"],
      classificationConfidence: 0.9,
      classificationSource: "yamnet_local",
      isExcluded: false,
      createdAt: "2026-09-02T10:00:00Z",
      updatedAt: "2026-09-02T10:00:00Z",
    },
    {
      id: "clip-3",
      parentFileId: "file-3",
      title: "Product Architecture Discussion",
      startTimeSeconds: 0,
      endTimeSeconds: 240,
      category: "dictaphone",
      userTags: ["Engineering"],
      classificationConfidence: 0.88,
      classificationSource: "whisper_local",
      isExcluded: false,
      fullTranscription: "We need to improve the onboarding pipeline and reduce ingestion latency.",
      createdAt: "2026-09-03T10:00:00Z",
      updatedAt: "2026-09-03T10:00:00Z",
    },
  ];

  describe("escapeRegex", () => {
    it("escapes regex control characters", () => {
      const escaped = escapeRegex("Take 1 (Cut 10s-20s) [HD] + * ?");
      expect(escaped).toContain("\\(");
      expect(escaped).toContain("\\[");
      expect(escaped).toContain("\\+");
      expect(escaped).toContain("\\*");
    });
  });

  describe("extractSnippet", () => {
    it("extracts contextual snippet around query", () => {
      const text = "We started the meeting early today. Our primary focus is customer onboarding and self-serve workflows for users.";
      const snippet = extractSnippet(text, "onboarding", 60);
      expect(snippet.toLowerCase()).toContain("onboarding");
    });
  });

  describe("searchLibrary", () => {
    it("matches query in clip title", () => {
      const results = searchLibrary(clips, "Quarterly Planning");
      expect(results.length).toBe(1);
      expect(results[0].clip.id).toBe("clip-1");
      expect(results[0].matchedInTitle).toBe(true);
    });

    it("matches query deep in transcripts with passage timestamp", () => {
      const results = searchLibrary(clips, "onboarding");
      expect(results.length).toBe(2);

      const clip1Result = results.find((r) => r.clip.id === "clip-1");
      expect(clip1Result).toBeDefined();
      expect(clip1Result?.passageHits.length).toBeGreaterThanOrEqual(1);
      expect(clip1Result?.passageHits[0].timestampLabel).toBe("01:24");
      expect(clip1Result?.passageHits[0].startSec).toBe(84);
      expect(clip1Result?.passageHits[0].snippet.toLowerCase()).toContain("onboarding");
    });

    it("handles regex characters in search query safely without throwing", () => {
      expect(() => {
        searchLibrary(clips, "Take 1 (");
      }).not.toThrow();

      const results = searchLibrary(clips, "(Take 1)");
      expect(results.length).toBe(1);
      expect(results[0].clip.id).toBe("clip-2");
    });

    it("respects scope filter", () => {
      // Titles only
      const titlesOnly = searchLibrary(clips, "onboarding", "titles");
      expect(titlesOnly.length).toBe(0);

      // Transcripts only
      const transcriptsOnly = searchLibrary(clips, "Acoustic", "transcripts");
      expect(transcriptsOnly.length).toBe(0);

      const transcriptsOnboarding = searchLibrary(clips, "onboarding", "transcripts");
      expect(transcriptsOnboarding.length).toBe(2);
    });

    it("ranks title matches above transcript-only matches", () => {
      const results = searchLibrary(clips, "Architecture");
      expect(results.length).toBe(1);
      expect(results[0].clip.id).toBe("clip-3");
      expect(results[0].matchedInTitle).toBe(true);
    });

    it("searches sound event classifications across both 'all' and 'transcripts' scopes", () => {
      const clipsWithSoundEvents: VirtualClip[] = [
        ...clips,
        {
          id: "clip-ambient-birds",
          parentFileId: "file-ambient",
          title: "Early Morning Forest",
          startTimeSeconds: 0,
          endTimeSeconds: 60,
          category: "ambient",
          userTags: ["Nature", "Birds chirping", "Owl call"],
          classificationConfidence: 0.92,
          classificationSource: "yamnet_local",
          isExcluded: false,
          transcription: "🎧 [Acoustic Scene]: Birds chirping, Owl call",
          fullTranscription: "[00:00] 🐦 Birds chirping (88%)\n\n[00:15] 🦉 Owl call (66%)",
          transcriptionChunks: [
            { text: "🐦 Birds chirping", timestamp: [0, 15] },
            { text: "🦉 Owl call", timestamp: [15, 30] },
          ],
          soundEvents: [
            { label: "Birds chirping", confidence: 0.88, timestamp: [0, 15], icon: "🐦" },
            { label: "Owl call", confidence: 0.66, timestamp: [15, 30], icon: "🦉" },
          ],
          createdAt: "2026-09-04T10:00:00Z",
          updatedAt: "2026-09-04T10:00:00Z",
        },
        {
          id: "clip-music-horse",
          parentFileId: "file-music",
          title: "Country Trail Jam",
          startTimeSeconds: 0,
          endTimeSeconds: 90,
          category: "music",
          userTags: ["Guitar", "Horse neigh"],
          classificationConfidence: 0.9,
          classificationSource: "yamnet_local",
          isExcluded: false,
          transcription: "Country tune with acoustic cues",
          fullTranscription: "[00:00] Strumming rhythm\n\n[00:30] [Sound Event: 🐴 Horse neigh]\n\n[01:00] Outro solo",
          transcriptionChunks: [
            { text: "Strumming rhythm", timestamp: [0, 30] },
            { text: "[Sound Event: 🐴 Horse neigh]", timestamp: [30, 45] },
            { text: "Outro solo", timestamp: [45, 90] },
          ],
          soundEvents: [
            { label: "Horse neigh", confidence: 0.95, timestamp: [30, 45], icon: "🐴" },
          ],
          createdAt: "2026-09-05T10:00:00Z",
          updatedAt: "2026-09-05T10:00:00Z",
        },
      ];

      // 1. Search 'bird' in 'transcripts' scope
      const birdTranscripts = searchLibrary(clipsWithSoundEvents, "bird", "transcripts");
      expect(birdTranscripts.length).toBe(1);
      expect(birdTranscripts[0].clip.id).toBe("clip-ambient-birds");
      expect(birdTranscripts[0].passageHits[0].snippet).toContain("Birds chirping");

      // 2. Search 'chirp' in 'all' scope
      const chirpAll = searchLibrary(clipsWithSoundEvents, "chirp", "all");
      expect(chirpAll.length).toBe(1);
      expect(chirpAll[0].clip.id).toBe("clip-ambient-birds");

      // 3. Search 'owl' in 'transcripts' scope
      const owlTranscripts = searchLibrary(clipsWithSoundEvents, "owl", "transcripts");
      expect(owlTranscripts.length).toBe(1);
      expect(owlTranscripts[0].clip.id).toBe("clip-ambient-birds");
      expect(owlTranscripts[0].passageHits.some((h) => h.snippet.includes("Owl"))).toBe(true);

      // 4. Search 'horse' in 'transcripts' scope (woven into music track)
      const horseTranscripts = searchLibrary(clipsWithSoundEvents, "horse", "transcripts");
      expect(horseTranscripts.length).toBe(1);
      expect(horseTranscripts[0].clip.id).toBe("clip-music-horse");
      expect(horseTranscripts[0].passageHits.some((h) => h.snippet.includes("Horse neigh"))).toBe(true);

      // 5. Search 'neigh' in 'all' scope
      const neighAll = searchLibrary(clipsWithSoundEvents, "neigh", "all");
      expect(neighAll.length).toBe(1);
      expect(neighAll[0].clip.id).toBe("clip-music-horse");
    });
  });
});
