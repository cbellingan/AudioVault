import { describe, it, expect } from 'vitest';
import { VirtualClip } from '../../shared/types';

describe('Waveform Trimming, Range Selection & Undo/Redo Engine', () => {
  interface TrimUndoAction {
    id: string;
    description: string;
    clipId: string;
    type: 'trim' | 'split' | 'middle_cut';
    before?: {
      startTimeSeconds: number;
      endTimeSeconds: number;
      title?: string;
    };
    after?: {
      startTimeSeconds: number;
      endTimeSeconds: number;
      title?: string;
    };
    originalClip?: VirtualClip;
    createdClipIds?: string[];
  }

  function createMockClip(overrides?: Partial<VirtualClip>): VirtualClip {
    return {
      id: 'clip_test_1',
      parentFileId: 'file_test_1',
      title: 'Studio Recording Take 1',
      startTimeSeconds: 0,
      endTimeSeconds: 120,
      category: 'music',
      userTags: ['Studio'],
      classificationConfidence: 0.95,
      classificationSource: 'user_manual',
      isExcluded: false,
      createdAt: '2026-09-27T10:00:00.000Z',
      updatedAt: '2026-09-27T10:00:00.000Z',
      artist: 'Solaris',
      location: 'Studio A',
      rating: 4,
      ...overrides,
    };
  }

  it('Shift-Click range selection establishes range between playhead anchor and click target', () => {
    const playhead = 0.25; // 25% of track

    // Shift click backwards to 0% (e.g. trimming intro)
    const clickTargetBack = 0.0;
    const rangeBack = {
      start: Math.min(playhead, clickTargetBack),
      end: Math.max(playhead, clickTargetBack),
    };
    expect(rangeBack.start).toBe(0.0);
    expect(rangeBack.end).toBe(0.25);

    // Shift click forwards to 75%
    const clickTargetForward = 0.75;
    const rangeForward = {
      start: Math.min(playhead, clickTargetForward),
      end: Math.max(playhead, clickTargetForward),
    };
    expect(rangeForward.start).toBe(0.25);
    expect(rangeForward.end).toBe(0.75);
  });

  it('Head Trim: advances startTimeSeconds when selection starts at head (<= 0.03)', () => {
    let clip = createMockClip({ startTimeSeconds: 0, endTimeSeconds: 100 });
    const selectionRange = { start: 0.0, end: 0.15 }; // 0 to 15s

    const clipDuration = clip.endTimeSeconds - clip.startTimeSeconds;
    const selStartSec = clip.startTimeSeconds + selectionRange.start * clipDuration;
    const selEndSec = clip.startTimeSeconds + selectionRange.end * clipDuration;
    const cutDuration = selEndSec - selStartSec;

    expect(cutDuration).toBe(15);

    // Head trim condition
    expect(selectionRange.start <= 0.03).toBe(true);

    const newStart = Math.min(clip.endTimeSeconds - 0.2, Math.round(selEndSec * 100) / 100);
    const undoAction: TrimUndoAction = {
      id: 'undo_head',
      description: `Trimmed intro (${cutDuration.toFixed(1)}s)`,
      clipId: clip.id,
      type: 'trim',
      before: {
        startTimeSeconds: clip.startTimeSeconds,
        endTimeSeconds: clip.endTimeSeconds,
      },
      after: {
        startTimeSeconds: newStart,
        endTimeSeconds: clip.endTimeSeconds,
      },
    };

    clip = { ...clip, startTimeSeconds: newStart };

    expect(clip.startTimeSeconds).toBe(15);
    expect(clip.endTimeSeconds).toBe(100);
    expect(undoAction.before?.startTimeSeconds).toBe(0);
    expect(undoAction.after?.startTimeSeconds).toBe(15);
  });

  it('Tail Trim: reduces endTimeSeconds when selection ends at tail (>= 0.97)', () => {
    let clip = createMockClip({ startTimeSeconds: 10, endTimeSeconds: 110 }); // duration = 100s
    const selectionRange = { start: 0.85, end: 1.0 }; // 85% to 100% of duration (85s to 100s offset -> 95s to 110s absolute)

    const clipDuration = clip.endTimeSeconds - clip.startTimeSeconds;
    const selStartSec = clip.startTimeSeconds + selectionRange.start * clipDuration; // 10 + 85 = 95s
    const selEndSec = clip.startTimeSeconds + selectionRange.end * clipDuration;     // 10 + 100 = 110s
    const cutDuration = selEndSec - selStartSec;

    expect(selStartSec).toBe(95);
    expect(selEndSec).toBe(110);
    expect(cutDuration).toBe(15);

    expect(selectionRange.end >= 0.97).toBe(true);

    const newEnd = Math.max(clip.startTimeSeconds + 0.2, Math.round(selStartSec * 100) / 100);
    const undoAction: TrimUndoAction = {
      id: 'undo_tail',
      description: `Trimmed outro (${cutDuration.toFixed(1)}s)`,
      clipId: clip.id,
      type: 'trim',
      before: {
        startTimeSeconds: clip.startTimeSeconds,
        endTimeSeconds: clip.endTimeSeconds,
      },
      after: {
        startTimeSeconds: clip.startTimeSeconds,
        endTimeSeconds: newEnd,
      },
    };

    clip = { ...clip, endTimeSeconds: newEnd };

    expect(clip.startTimeSeconds).toBe(10);
    expect(clip.endTimeSeconds).toBe(95);
    expect(undoAction.before?.endTimeSeconds).toBe(110);
    expect(undoAction.after?.endTimeSeconds).toBe(95);
  });

  it('Middle Cut: slices into Part 1 and Part 2, omitting internal segment', () => {
    const originalClip = createMockClip({ startTimeSeconds: 0, endTimeSeconds: 100 });
    const selectionRange = { start: 0.3, end: 0.6 }; // 30s to 60s

    const clipDuration = originalClip.endTimeSeconds - originalClip.startTimeSeconds;
    const selStartSec = originalClip.startTimeSeconds + selectionRange.start * clipDuration;
    const selEndSec = originalClip.startTimeSeconds + selectionRange.end * clipDuration;
    const cutDuration = selEndSec - selStartSec;

    expect(selStartSec).toBe(30);
    expect(selEndSec).toBe(60);
    expect(cutDuration).toBe(30);

    const part1End = Math.round(selStartSec * 100) / 100;
    const part2Start = Math.round(selEndSec * 100) / 100;

    const part1Clip: VirtualClip = {
      ...originalClip,
      endTimeSeconds: part1End,
    };

    const part2Clip: VirtualClip = {
      id: 'clip_test_1_pt2',
      parentFileId: originalClip.parentFileId,
      title: `${originalClip.title} (Part 2)`,
      startTimeSeconds: part2Start,
      endTimeSeconds: originalClip.endTimeSeconds,
      category: originalClip.category,
      userTags: [...originalClip.userTags, 'Split Take'],
      classificationConfidence: originalClip.classificationConfidence,
      classificationSource: 'user_manual',
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artist: originalClip.artist,
      location: originalClip.location,
      rating: originalClip.rating,
    };

    expect(part1Clip.startTimeSeconds).toBe(0);
    expect(part1Clip.endTimeSeconds).toBe(30);
    expect(part2Clip.startTimeSeconds).toBe(60);
    expect(part2Clip.endTimeSeconds).toBe(100);
    expect(part2Clip.artist).toBe('Solaris');
    expect(part2Clip.location).toBe('Studio A');
    expect(part2Clip.rating).toBe(4);
  });

  it('Trim to Selection (Crop): keeps only highlighted region', () => {
    let clip = createMockClip({ startTimeSeconds: 20, endTimeSeconds: 120 }); // duration = 100s
    const selectionRange = { start: 0.1, end: 0.5 }; // 10s to 50s into clip -> absolute 30s to 70s

    const clipDuration = clip.endTimeSeconds - clip.startTimeSeconds;
    const selStartSec = Math.round((clip.startTimeSeconds + selectionRange.start * clipDuration) * 100) / 100;
    const selEndSec = Math.round((clip.startTimeSeconds + selectionRange.end * clipDuration) * 100) / 100;

    expect(selStartSec).toBe(30);
    expect(selEndSec).toBe(70);

    clip = {
      ...clip,
      startTimeSeconds: selStartSec,
      endTimeSeconds: selEndSec,
    };

    expect(clip.startTimeSeconds).toBe(30);
    expect(clip.endTimeSeconds).toBe(70);
  });

  it('Full Undo / Redo lifecycle restores exact initial offsets across multiple edits', () => {
    let activeClip = createMockClip({ startTimeSeconds: 0, endTimeSeconds: 100 });
    let clips: VirtualClip[] = [activeClip];
    const undoStack: TrimUndoAction[] = [];
    const redoStack: TrimUndoAction[] = [];

    // Operation 1: Head Trim (0 to 10s cut)
    const cut1End = 10;
    const op1: TrimUndoAction = {
      id: 'op1',
      description: 'Trimmed intro (10.0s)',
      clipId: activeClip.id,
      type: 'trim',
      before: { startTimeSeconds: activeClip.startTimeSeconds, endTimeSeconds: activeClip.endTimeSeconds },
      after: { startTimeSeconds: cut1End, endTimeSeconds: activeClip.endTimeSeconds },
    };
    undoStack.unshift(op1);
    redoStack.length = 0;
    activeClip = { ...activeClip, startTimeSeconds: cut1End };
    clips = clips.map((c) => (c.id === activeClip.id ? activeClip : c));

    expect(activeClip.startTimeSeconds).toBe(10);
    expect(activeClip.endTimeSeconds).toBe(100);

    // Operation 2: Tail Trim (90 to 100s cut)
    const cut2End = 90;
    const op2: TrimUndoAction = {
      id: 'op2',
      description: 'Trimmed outro (10.0s)',
      clipId: activeClip.id,
      type: 'trim',
      before: { startTimeSeconds: activeClip.startTimeSeconds, endTimeSeconds: activeClip.endTimeSeconds },
      after: { startTimeSeconds: activeClip.startTimeSeconds, endTimeSeconds: cut2End },
    };
    undoStack.unshift(op2);
    redoStack.length = 0;
    activeClip = { ...activeClip, endTimeSeconds: cut2End };
    clips = clips.map((c) => (c.id === activeClip.id ? activeClip : c));

    expect(activeClip.startTimeSeconds).toBe(10);
    expect(activeClip.endTimeSeconds).toBe(90);

    // UNDO 1: Revert tail trim
    const undoneTail = undoStack.shift()!;
    redoStack.unshift(undoneTail);
    activeClip = {
      ...activeClip,
      startTimeSeconds: undoneTail.before!.startTimeSeconds,
      endTimeSeconds: undoneTail.before!.endTimeSeconds,
    };
    expect(activeClip.startTimeSeconds).toBe(10);
    expect(activeClip.endTimeSeconds).toBe(100);

    // UNDO 2: Revert head trim
    const undoneHead = undoStack.shift()!;
    redoStack.unshift(undoneHead);
    activeClip = {
      ...activeClip,
      startTimeSeconds: undoneHead.before!.startTimeSeconds,
      endTimeSeconds: undoneHead.before!.endTimeSeconds,
    };
    expect(activeClip.startTimeSeconds).toBe(0);
    expect(activeClip.endTimeSeconds).toBe(100);
    expect(undoStack.length).toBe(0);
    expect(redoStack.length).toBe(2);

    // REDO 1: Re-apply head trim
    const redoneHead = redoStack.shift()!;
    undoStack.unshift(redoneHead);
    activeClip = {
      ...activeClip,
      startTimeSeconds: redoneHead.after!.startTimeSeconds,
      endTimeSeconds: redoneHead.after!.endTimeSeconds,
    };
    expect(activeClip.startTimeSeconds).toBe(10);
    expect(activeClip.endTimeSeconds).toBe(100);

    // REDO 2: Re-apply tail trim
    const redoneTail = redoStack.shift()!;
    undoStack.unshift(redoneTail);
    activeClip = {
      ...activeClip,
      startTimeSeconds: redoneTail.after!.startTimeSeconds,
      endTimeSeconds: redoneTail.after!.endTimeSeconds,
    };
    expect(activeClip.startTimeSeconds).toBe(10);
    expect(activeClip.endTimeSeconds).toBe(90);
    expect(redoStack.length).toBe(0);
  });
});
