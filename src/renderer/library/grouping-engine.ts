import { VirtualClip } from '../../shared/types';

export type GroupingMode = 'month' | 'batch' | 'collection' | 'none';
export type TranscriptStatusFilter = 'all' | 'ready' | 'pending' | 'nospeech' | 'failed';

export interface HierarchyItem {
  primaryClip: VirtualClip;
  excerpts: VirtualClip[];
}

export interface GroupedSection {
  key: string;
  label: string;
  count: number;
  totalDurationSeconds: number;
  items: HierarchyItem[];
}

/**
 * Determine the transcript processing status for a clip.
 */
export function getClipTranscriptStatus(clip: VirtualClip): 'ready' | 'pending' | 'nospeech' | 'failed' {
  const text = (clip.fullTranscription || clip.transcription || '').trim().toLowerCase();
  const tags = clip.userTags.map((t) => t.toLowerCase());
  if (
    text.includes('[transcription failed]') ||
    text.includes('error') ||
    tags.includes('failed')
  ) {
    return 'failed';
  }
  if (
    text.includes('[no speech detected]') ||
    text.includes('[instrumental]') ||
    text.includes('[silence]') ||
    tags.includes('no speech')
  ) {
    return 'nospeech';
  }
  if (text.length > 0 || (Array.isArray(clip.transcriptionChunks) && clip.transcriptionChunks.length > 0)) {
    return 'ready';
  }
  return 'pending';
}

/**
 * Filter clips by their transcription status.
 */
export function filterClipsByTranscriptStatus(
  clips: VirtualClip[],
  status: TranscriptStatusFilter
): VirtualClip[] {
  if (status === 'all') return clips;
  return clips.filter((c) => getClipTranscriptStatus(c) === status);
}

/**
 * Group flat virtual clips into primary recording takes and nested child excerpts.
 */
export function buildHierarchy(clips: VirtualClip[]): HierarchyItem[] {
  const primaryTakes: VirtualClip[] = [];
  const excerptsByParentFileId = new Map<string, VirtualClip[]>();

  for (const clip of clips) {
    const isExcerpt =
      clip.startTimeSeconds > 0 ||
      clip.userTags.includes('Excerpt') ||
      clip.id.includes('_excerpt_');

    if (isExcerpt) {
      const existing = excerptsByParentFileId.get(clip.parentFileId) || [];
      existing.push(clip);
      excerptsByParentFileId.set(clip.parentFileId, existing);
    } else {
      primaryTakes.push(clip);
    }
  }

  // If an excerpt has no matching primary take (e.g. primary was deleted or filtered),
  // promote it to a standalone primary take so it remains visible
  const primaryParentIds = new Set(primaryTakes.map((p) => p.parentFileId));
  for (const [parentFileId, orphanedExcerpts] of excerptsByParentFileId.entries()) {
    if (!primaryParentIds.has(parentFileId)) {
      primaryTakes.push(...orphanedExcerpts);
      excerptsByParentFileId.delete(parentFileId);
    }
  }

  return primaryTakes.map((primaryClip) => ({
    primaryClip,
    excerpts: excerptsByParentFileId.get(primaryClip.parentFileId) || [],
  }));
}

/**
 * Format month label from ISO string (e.g. "2026-09-15" -> "September 2026").
 */
export function formatMonthLabel(dateStr?: string): { key: string; label: string } {
  if (!dateStr) {
    return { key: 'unknown', label: 'Recorded Date Unknown' };
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { key: 'unknown', label: 'Recorded Date Unknown' };
  }
  const year = date.getFullYear();
  const month = date.toLocaleString('default', { month: 'long' });
  const key = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { key, label: `${month} ${year}` };
}

/**
 * Group library hierarchy items by recorded month, import batch, collection, or none.
 */
export function groupLibrary(items: HierarchyItem[], mode: GroupingMode): GroupedSection[] {
  if (mode === 'none') {
    const totalDuration = items.reduce(
      (sum, item) => sum + Math.max(0, item.primaryClip.endTimeSeconds - item.primaryClip.startTimeSeconds),
      0
    );
    return [
      {
        key: 'all',
        label: 'All Recordings',
        count: items.length,
        totalDurationSeconds: totalDuration,
        items,
      },
    ];
  }

  const sectionsMap = new Map<string, GroupedSection>();

  for (const item of items) {
    const clip = item.primaryClip;
    const dur = Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds);

    if (mode === 'month') {
      const { key, label } = formatMonthLabel(clip.recordedAt || clip.createdAt);
      if (!sectionsMap.has(key)) {
        sectionsMap.set(key, { key, label, count: 0, totalDurationSeconds: 0, items: [] });
      }
      const section = sectionsMap.get(key)!;
      section.count += 1;
      section.totalDurationSeconds += dur;
      section.items.push(item);
    } else if (mode === 'batch') {
      const key = clip.batchId || 'unbatched';
      const label = clip.batchId ? `Batch: ${clip.batchId}` : 'Unbatched Takes';
      if (!sectionsMap.has(key)) {
        sectionsMap.set(key, { key, label, count: 0, totalDurationSeconds: 0, items: [] });
      }
      const section = sectionsMap.get(key)!;
      section.count += 1;
      section.totalDurationSeconds += dur;
      section.items.push(item);
    } else if (mode === 'collection') {
      const collections = (clip.collections && clip.collections.length > 0) ? clip.collections : ['Unassigned'];
      for (const col of collections) {
        const key = `col_${col.toLowerCase().replace(/\s+/g, '_')}`;
        const label = col;
        if (!sectionsMap.has(key)) {
          sectionsMap.set(key, { key, label, count: 0, totalDurationSeconds: 0, items: [] });
        }
        const section = sectionsMap.get(key)!;
        section.count += 1;
        section.totalDurationSeconds += dur;
        section.items.push(item);
      }
    }
  }

  const sections = Array.from(sectionsMap.values());

  // Sort sections chronologically descending for month/batch, alphabetically for collection
  if (mode === 'month') {
    sections.sort((a, b) => {
      if (a.key === 'unknown') return 1;
      if (b.key === 'unknown') return -1;
      return b.key.localeCompare(a.key);
    });
  } else if (mode === 'collection') {
    sections.sort((a, b) => {
      if (a.label === 'Unassigned') return 1;
      if (b.label === 'Unassigned') return -1;
      return a.label.localeCompare(b.label);
    });
  }

  return sections;
}
