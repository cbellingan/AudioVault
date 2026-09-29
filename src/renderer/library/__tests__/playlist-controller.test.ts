import { describe, it, expect } from 'vitest';
import { findNextTrack, findPrevTrack, getPlaylistPosition } from '../playlist-controller';
import { VirtualClip } from '../../../shared/types';

function createMockClip(id: string, title: string): VirtualClip {
  return {
    id,
    parentFileId: 'parent-1',
    title,
    category: 'music',
    startTimeSeconds: 0,
    endTimeSeconds: 30,
    userTags: [],
    classificationConfidence: 0.95,
    classificationSource: 'yamnet_local',
    isExcluded: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('Playlist Controller Unit Tests', () => {
  const clips = [
    createMockClip('clip-1', 'Track 1 - Intro'),
    createMockClip('clip-2', 'Track 2 - Verse'),
    createMockClip('clip-3', 'Track 3 - Chorus'),
    createMockClip('clip-4', 'Track 4 - Outro'),
  ];

  describe('findNextTrack', () => {
    it('returns the subsequent track in sequence', () => {
      const next = findNextTrack('clip-1', clips);
      expect(next).toBeDefined();
      expect(next?.id).toBe('clip-2');

      const nextAfter2 = findNextTrack('clip-2', clips);
      expect(nextAfter2?.id).toBe('clip-3');
    });

    it('returns null when at the end of the playlist', () => {
      const next = findNextTrack('clip-4', clips);
      expect(next).toBeNull();
    });

    it('returns null when active clip is not in list', () => {
      const next = findNextTrack('unknown-clip', clips);
      expect(next).toBeNull();
    });

    it('handles empty or null parameters gracefully', () => {
      expect(findNextTrack(null, clips)).toBeNull();
      expect(findNextTrack(undefined, clips)).toBeNull();
      expect(findNextTrack('clip-1', [])).toBeNull();
    });
  });

  describe('findPrevTrack', () => {
    it('returns the preceding track in sequence', () => {
      const prev = findPrevTrack('clip-3', clips);
      expect(prev).toBeDefined();
      expect(prev?.id).toBe('clip-2');

      const prevFrom2 = findPrevTrack('clip-2', clips);
      expect(prevFrom2?.id).toBe('clip-1');
    });

    it('returns null when at the start of the playlist', () => {
      const prev = findPrevTrack('clip-1', clips);
      expect(prev).toBeNull();
    });

    it('returns null when active clip is not in list', () => {
      const prev = findPrevTrack('unknown-clip', clips);
      expect(prev).toBeNull();
    });

    it('handles empty or null parameters gracefully', () => {
      expect(findPrevTrack(null, clips)).toBeNull();
      expect(findPrevTrack(undefined, clips)).toBeNull();
      expect(findPrevTrack('clip-2', [])).toBeNull();
    });
  });

  describe('getPlaylistPosition', () => {
    it('correctly calculates 1-based index and boundary flags', () => {
      const pos1 = getPlaylistPosition('clip-1', clips);
      expect(pos1.currentIndex).toBe(1);
      expect(pos1.totalCount).toBe(4);
      expect(pos1.hasPrev).toBe(false);
      expect(pos1.hasNext).toBe(true);
      expect(pos1.label).toBe('Track 1 of 4');

      const pos3 = getPlaylistPosition('clip-3', clips);
      expect(pos3.currentIndex).toBe(3);
      expect(pos3.totalCount).toBe(4);
      expect(pos3.hasPrev).toBe(true);
      expect(pos3.hasNext).toBe(true);
      expect(pos3.label).toBe('Track 3 of 4');

      const pos4 = getPlaylistPosition('clip-4', clips);
      expect(pos4.currentIndex).toBe(4);
      expect(pos4.totalCount).toBe(4);
      expect(pos4.hasPrev).toBe(true);
      expect(pos4.hasNext).toBe(false);
      expect(pos4.label).toBe('Track 4 of 4');
    });

    it('handles unknown clip or empty list', () => {
      const emptyPos = getPlaylistPosition('clip-1', []);
      expect(emptyPos.currentIndex).toBe(0);
      expect(emptyPos.totalCount).toBe(0);
      expect(emptyPos.label).toBe('No tracks');

      const missingPos = getPlaylistPosition('clip-99', clips);
      expect(missingPos.currentIndex).toBe(0);
      expect(missingPos.totalCount).toBe(4);
      expect(missingPos.label).toBe('0 of 4');
    });
  });
});
