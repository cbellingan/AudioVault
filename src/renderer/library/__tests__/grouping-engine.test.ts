import { describe, it, expect } from 'vitest';
import {
  getClipTranscriptStatus,
  filterClipsByTranscriptStatus,
  buildHierarchy,
  formatMonthLabel,
  groupLibrary,
} from '../grouping-engine';
import { VirtualClip } from '../../../shared/types';

describe('Slice F03: Library Grouping & Hierarchy Engine', () => {
  const mockClips: VirtualClip[] = [
    {
      id: 'clip_01',
      parentFileId: 'raw_01',
      title: 'Primary Take 1',
      startTimeSeconds: 0,
      endTimeSeconds: 120,
      category: 'music',
      userTags: ['Songwriting'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      transcription: 'Acoustic guitar in G major',
      fullTranscription: 'Acoustic guitar in G major',
      isExcluded: false,
      createdAt: '2026-09-10T12:00:00.000Z',
      recordedAt: '2026-09-10T12:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
      batchId: 'batch_01',
      collections: ['Acoustic Sessions'],
      favorite: true,
      reviewed: true,
    },
    {
      id: 'clip_01_excerpt_1',
      parentFileId: 'raw_01',
      title: 'Excerpt: Solo Take',
      startTimeSeconds: 30,
      endTimeSeconds: 65,
      category: 'music',
      userTags: ['Excerpt'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      transcription: 'Solo section in G major',
      isExcluded: false,
      createdAt: '2026-09-10T12:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
    },
    {
      id: 'clip_02',
      parentFileId: 'raw_02',
      title: 'Ambient Field Recording',
      startTimeSeconds: 0,
      endTimeSeconds: 300,
      category: 'ambient',
      userTags: ['Nature'],
      classificationConfidence: 0.95,
      classificationSource: 'yamnet_local',
      transcription: '[No speech detected]',
      isExcluded: false,
      createdAt: '2026-08-15T09:30:00.000Z',
      recordedAt: '2026-08-15T09:30:00.000Z',
      updatedAt: '2026-08-15T09:30:00.000Z',
      batchId: 'batch_02',
      collections: ['Field Research'],
    },
    {
      id: 'clip_03',
      parentFileId: 'raw_03',
      title: 'Product Discussion',
      startTimeSeconds: 0,
      endTimeSeconds: 540,
      category: 'meeting',
      userTags: ['Planning'],
      classificationConfidence: 0.88,
      classificationSource: 'whisper_local',
      isExcluded: false,
      createdAt: '2026-08-12T14:00:00.000Z',
      updatedAt: '2026-08-12T14:00:00.000Z',
    },
    {
      id: 'clip_04',
      parentFileId: 'raw_04',
      title: 'Corrupt Audio File',
      startTimeSeconds: 0,
      endTimeSeconds: 15,
      category: 'unclassified',
      userTags: [],
      classificationConfidence: 0.1,
      classificationSource: 'whisper_local',
      transcription: '[Transcription failed]: decoder error',
      isExcluded: false,
      createdAt: '2026-07-04T10:00:00.000Z',
      updatedAt: '2026-07-04T10:00:00.000Z',
    },
    {
      id: 'clip_05',
      parentFileId: 'raw_05',
      title: 'Ancient Recording with Unknown Date',
      startTimeSeconds: 0,
      endTimeSeconds: 45,
      category: 'dictaphone',
      userTags: ['Vintage'],
      classificationConfidence: 0.8,
      classificationSource: 'yamnet_local',
      isExcluded: false,
      createdAt: '',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  it('correctly categorizes transcript statuses', () => {
    expect(getClipTranscriptStatus(mockClips[0])).toBe('ready');
    expect(getClipTranscriptStatus(mockClips[2])).toBe('nospeech');
    expect(getClipTranscriptStatus(mockClips[3])).toBe('pending');
    expect(getClipTranscriptStatus(mockClips[4])).toBe('failed');
  });

  it('filters clips by transcript status', () => {
    const readyClips = filterClipsByTranscriptStatus(mockClips, 'ready');
    expect(readyClips.map((c) => c.id)).toContain('clip_01');
    expect(readyClips.map((c) => c.id)).toContain('clip_01_excerpt_1');

    const failedClips = filterClipsByTranscriptStatus(mockClips, 'failed');
    expect(failedClips.length).toBe(1);
    expect(failedClips[0].id).toBe('clip_04');

    const noSpeechClips = filterClipsByTranscriptStatus(mockClips, 'nospeech');
    expect(noSpeechClips.length).toBe(1);
    expect(noSpeechClips[0].id).toBe('clip_02');
  });

  it('builds parent-child hierarchy nesting excerpts under primary takes', () => {
    const hierarchy = buildHierarchy(mockClips);
    // clip_01 should have excerpt clip_01_excerpt_1 nested under it
    const primary1 = hierarchy.find((h) => h.primaryClip.id === 'clip_01');
    expect(primary1).toBeDefined();
    expect(primary1?.excerpts.length).toBe(1);
    expect(primary1?.excerpts[0].id).toBe('clip_01_excerpt_1');

    // Total primary takes should be 5 (clip_01, clip_02, clip_03, clip_04, clip_05)
    expect(hierarchy.length).toBe(5);
  });

  it('formats month labels and preserves unknown provenance', () => {
    expect(formatMonthLabel('2026-09-10T12:00:00.000Z')).toEqual({
      key: '2026-09',
      label: 'September 2026',
    });
    expect(formatMonthLabel('')).toEqual({
      key: 'unknown',
      label: 'Recorded Date Unknown',
    });
    expect(formatMonthLabel(undefined)).toEqual({
      key: 'unknown',
      label: 'Recorded Date Unknown',
    });
  });

  it('groups items by month in chronological descending order', () => {
    const hierarchy = buildHierarchy(mockClips);
    const grouped = groupLibrary(hierarchy, 'month');

    // Expected sections: September 2026, August 2026, July 2026, Recorded Date Unknown
    const keys = grouped.map((g) => g.key);
    expect(keys).toEqual(['2026-09', '2026-08', '2026-07', 'unknown']);

    const sepSection = grouped.find((g) => g.key === '2026-09');
    expect(sepSection?.count).toBe(1);
    expect(sepSection?.label).toBe('September 2026');

    const unknownSection = grouped.find((g) => g.key === 'unknown');
    expect(unknownSection?.count).toBe(1);
    expect(unknownSection?.label).toBe('Recorded Date Unknown');
  });

  it('groups items by collection and handles unassigned takes', () => {
    const hierarchy = buildHierarchy(mockClips);
    const grouped = groupLibrary(hierarchy, 'collection');

    const labels = grouped.map((g) => g.label);
    expect(labels).toContain('Acoustic Sessions');
    expect(labels).toContain('Field Research');
    expect(labels).toContain('Unassigned');
  });

  it('handles flat ungrouped mode (none)', () => {
    const hierarchy = buildHierarchy(mockClips);
    const grouped = groupLibrary(hierarchy, 'none');

    expect(grouped.length).toBe(1);
    expect(grouped[0].key).toBe('all');
    expect(grouped[0].count).toBe(5);
  });
});
