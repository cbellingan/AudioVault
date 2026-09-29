import { VirtualClip } from '../../shared/types';

export interface PlaylistPosition {
  currentIndex: number; // 1-based index, 0 if not found
  totalCount: number;
  hasNext: boolean;
  hasPrev: boolean;
  label: string; // e.g. "Track 3 of 12" or "No tracks"
}

/**
 * Finds the track immediately following the current clip in the provided list.
 */
export function findNextTrack(
  currentClipId: string | null | undefined,
  clips: VirtualClip[]
): VirtualClip | null {
  if (!currentClipId || !clips || clips.length === 0) return null;
  const idx = clips.findIndex((c) => c.id === currentClipId);
  if (idx === -1 || idx >= clips.length - 1) return null;
  return clips[idx + 1];
}

/**
 * Finds the track immediately preceding the current clip in the provided list.
 */
export function findPrevTrack(
  currentClipId: string | null | undefined,
  clips: VirtualClip[]
): VirtualClip | null {
  if (!currentClipId || !clips || clips.length === 0) return null;
  const idx = clips.findIndex((c) => c.id === currentClipId);
  if (idx <= 0) return null;
  return clips[idx - 1];
}

/**
 * Computes playlist queue position (1-based index, total count, label).
 */
export function getPlaylistPosition(
  currentClipId: string | null | undefined,
  clips: VirtualClip[]
): PlaylistPosition {
  const totalCount = clips?.length || 0;
  if (!currentClipId || totalCount === 0) {
    return {
      currentIndex: 0,
      totalCount,
      hasNext: false,
      hasPrev: false,
      label: totalCount === 0 ? 'No tracks' : `0 of ${totalCount}`,
    };
  }

  const idx = clips.findIndex((c) => c.id === currentClipId);
  if (idx === -1) {
    return {
      currentIndex: 0,
      totalCount,
      hasNext: false,
      hasPrev: false,
      label: `0 of ${totalCount}`,
    };
  }

  const currentIndex = idx + 1;
  return {
    currentIndex,
    totalCount,
    hasNext: idx < totalCount - 1,
    hasPrev: idx > 0,
    label: `Track ${currentIndex} of ${totalCount}`,
  };
}
