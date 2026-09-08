import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  PrimaryCategory,
  RawAudioFile,
  VirtualClip,
  VolumeDetectedEvent,
  VaultSettings,
  PipelineStatusEvent,
  IngestJobProgress,
} from '../shared/types';

// Standalone fallback mock data
const mockFallbackClips: VirtualClip[] = [
  {
    id: 'clip_01',
    parentFileId: 'raw_01',
    title: 'ZOOM0001 - Harmony Warmups',
    startTimeSeconds: 0,
    endTimeSeconds: 42.5,
    category: 'music',
    userTags: ['Vocal Warmup', 'Soprano Practice'],
    classificationConfidence: 0.94,
    classificationSource: 'yamnet_local',
    isExcluded: false,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clip_02',
    parentFileId: 'raw_02',
    title: 'ZOOM0002 - Acoustic Set Take 1',
    startTimeSeconds: 0,
    endTimeSeconds: 184.0,
    category: 'concerts',
    userTags: ['Live Set', 'Acoustic Guitar'],
    classificationConfidence: 0.89,
    classificationSource: 'yamnet_local',
    isExcluded: false,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clip_03',
    parentFileId: 'raw_03',
    title: 'STE-003 - Product Standup',
    startTimeSeconds: 0,
    endTimeSeconds: 610.0,
    category: 'meeting',
    userTags: ['Sprint Planning', 'Engineering'],
    classificationConfidence: 0.87,
    classificationSource: 'whisper_local',
    transcription: '[Local Whisper]: "...the audio pipeline handles unmounting cleanly..."',
    isExcluded: false,
    createdAt: new Date(Date.now() - 14400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clip_04',
    parentFileId: 'raw_04',
    title: 'ZOOM0004 - Quick Melodic Idea',
    startTimeSeconds: 0,
    endTimeSeconds: 24.2,
    category: 'dictaphone',
    userTags: ['Voice Memo', 'Song Idea'],
    classificationConfidence: 0.92,
    classificationSource: 'yamnet_local',
    transcription: '[Local Whisper]: "...chord progression in D minor..."',
    isExcluded: false,
    createdAt: new Date(Date.now() - 28800000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockFallbackPeaks = Array.from({ length: 120 }, () => Math.random() * 0.75 + 0.15);

interface TimedWord {
  id: string;
  word: string;
  startSec: number;
  endSec: number;
}

export default function App() {
  const [clips, setClips] = useState<VirtualClip[]>(mockFallbackClips);
  const [rawFiles, setRawFiles] = useState<RawAudioFile[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string>(mockFallbackClips[0].id);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [detectedVolume, setDetectedVolume] = useState<VolumeDetectedEvent | null>(null);
  const [autoUnmountPref, setAutoUnmountPref] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0.2); // 0.0 - 1.0
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatusEvent | null>(null);
  
  // Table Sorting state: starts desc on creation / import time
  type SortField = 'title' | 'category' | 'duration' | 'tags' | 'confidence' | 'createdAt';
  type SortOrder = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Selection range on waveform
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>({
    start: 0.15,
    end: 0.45,
  });
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);

  const activeClip = clips.find((c) => c.id === selectedClipId) || clips[0] || mockFallbackClips[0];

  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Parse speech transcript into timed words for synchronized scrolling
  const activeWords = useMemo<TimedWord[]>(() => {
    if (!activeClip) return [];
    const duration = Math.max(0.1, activeClip.endTimeSeconds - activeClip.startTimeSeconds);

    // 1. If clip has precise Whisper timestamp chunks
    if (activeClip.transcriptionChunks && activeClip.transcriptionChunks.length > 0) {
      const words: TimedWord[] = [];
      activeClip.transcriptionChunks.forEach((chunk, chunkIdx) => {
        const rawTokens = chunk.text.trim().split(/\s+/).filter(Boolean);
        if (rawTokens.length === 0) return;
        const [chunkStart, chunkEnd] = chunk.timestamp;
        const chunkDur = Math.max(0.1, chunkEnd - chunkStart);
        const perWord = chunkDur / rawTokens.length;

        rawTokens.forEach((tok, wIdx) => {
          words.push({
            id: `chunk_${chunkIdx}_word_${wIdx}`,
            word: tok,
            startSec: chunkStart + wIdx * perWord,
            endSec: chunkStart + (wIdx + 1) * perWord,
          });
        });
      });
      if (words.length > 0) return words;
    }

    // 2. Fallback: Parse plain transcription string and distribute across duration
    if (activeClip.transcription) {
      const cleanText = activeClip.transcription
        .replace(/^\[[^\]]+\]:\s*"?/, '')
        .replace(/"?$/, '')
        .trim();
      const rawTokens = cleanText.split(/\s+/).filter(Boolean);
      if (rawTokens.length === 0) return [];

      const perWord = duration / rawTokens.length;
      return rawTokens.map((tok, i) => ({
        id: `word_${i}`,
        word: tok,
        startSec: i * perWord,
        endSec: (i + 1) * perWord,
      }));
    }

    return [];
  }, [activeClip]);

  // Determine currently active word index based on playback time
  const activeWordIndex = useMemo(() => {
    if (activeWords.length === 0) return -1;

    for (let i = 0; i < activeWords.length; i++) {
      if (currentTimeSec >= activeWords[i].startSec && currentTimeSec <= activeWords[i].endSec) {
        return i;
      }
    }

    // If within 2.5 seconds of a word, highlight it
    for (let i = 0; i < activeWords.length; i++) {
      if (Math.abs(activeWords[i].startSec - currentTimeSec) <= 2.5) {
        return i;
      }
    }

    // If within 3 seconds after the last word, keep it
    const lastWord = activeWords[activeWords.length - 1];
    if (currentTimeSec >= lastWord.endSec && currentTimeSec <= lastWord.endSec + 3.0) {
      return activeWords.length - 1;
    }

    return -1;
  }, [activeWords, currentTimeSec]);

  // Find next upcoming speech timestamp if currently in an instrumental section
  const nextSpeechStart = useMemo(() => {
    if (activeWords.length === 0) return null;
    const futureWord = activeWords.find((w) => w.startSec > currentTimeSec);
    return futureWord ? futureWord.startSec : null;
  }, [activeWords, currentTimeSec]);

  // Synchronously scroll the transcript ribbon with the waveform playhead
  useEffect(() => {
    if (activeWordIndex < 0 || !transcriptScrollRef.current) return;
    const container = transcriptScrollRef.current;
    const activeEl = wordRefs.current[activeWordIndex];
    if (activeEl) {
      const targetLeft = activeEl.offsetLeft - (container.clientWidth / 2) + (activeEl.clientWidth / 2);
      container.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      });
    }
  }, [activeWordIndex]);

  function handleSeekToWord(relativeStartSec: number) {
    if (!activeClip) return;
    const duration = Math.max(0.1, activeClip.endTimeSeconds - activeClip.startTimeSeconds);
    const clampedSec = Math.max(0, Math.min(duration, relativeStartSec));
    const newProgress = clampedSec / duration;

    setPlaybackProgress(newProgress);
    setCurrentTimeSec(clampedSec);

    if (audioRef.current) {
      audioRef.current.currentTime = activeClip.startTimeSeconds + clampedSec;
    }
  }

  useEffect(() => {
    let ticker: NodeJS.Timeout | null = null;

    if (isPlaying) {
      if (audioRef.current && audioRef.current.src && !audioRef.current.src.includes('undefined')) {
        audioRef.current.play().catch((_err) => {
          // Virtual clip or headless audio fallback
        });
      }

      // Smoothly advance playback ticker if audio element is paused or virtual
      ticker = setInterval(() => {
        if (!audioRef.current || audioRef.current.paused) {
          setCurrentTimeSec((prev) => {
            const duration = Math.max(1, activeClip.endTimeSeconds - activeClip.startTimeSeconds);
            const next = prev + 0.1;
            if (next >= duration) {
              setIsPlaying(false);
              setPlaybackProgress(0);
              return 0;
            }
            setPlaybackProgress(next / duration);
            return next;
          });
        }
      }, 100);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }

    return () => {
      if (ticker) clearInterval(ticker);
    };
  }, [isPlaying, activeClip]);

  useEffect(() => {
    setIsPlaying(false);
    setPlaybackProgress(0);
    setCurrentTimeSec(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [selectedClipId]);

  useEffect(() => {
    if (window.audioVault) {
      loadInitialVaultData();
      const unsubscribeVolume = window.audioVault.onVolumeDetected((event) => {
        setDetectedVolume(event);
      });
      const unsubscribePipeline = window.audioVault.onPipelineStatus((status) => {
        setPipelineStatus(status);
        window.audioVault.getVirtualClips().then((all) => {
          if (all.length > 0) setClips(all);
        });
      });
      return () => {
        unsubscribeVolume();
        unsubscribePipeline();
      };
    }
  }, []);

  // Global Keyboard Shortcuts (Space to Play/Pause, Arrow keys to Seek)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (audioRef.current && activeClip) {
          const newTime = Math.max(activeClip.startTimeSeconds, audioRef.current.currentTime - 3);
          audioRef.current.currentTime = newTime;
          const duration = activeClip.endTimeSeconds - activeClip.startTimeSeconds;
          if (duration > 0) {
            setPlaybackProgress((newTime - activeClip.startTimeSeconds) / duration);
          }
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (audioRef.current && activeClip) {
          const newTime = Math.min(activeClip.endTimeSeconds, audioRef.current.currentTime + 3);
          audioRef.current.currentTime = newTime;
          const duration = activeClip.endTimeSeconds - activeClip.startTimeSeconds;
          if (duration > 0) {
            setPlaybackProgress((newTime - activeClip.startTimeSeconds) / duration);
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeClip]);

  async function loadInitialVaultData() {
    try {
      const [allClips, allRaw, settings] = await Promise.all([
        window.audioVault.getVirtualClips(),
        window.audioVault.getRawFiles(),
        window.audioVault.getVaultSettings(),
      ]);
      if (allClips.length > 0) {
        setClips(allClips);
        setSelectedClipId(allClips[0].id);
      }
      setRawFiles(allRaw);
      setAutoUnmountPref(settings.autoUnmountAfterIngest);

      // Initial check for mounted drives
      const volumes = await window.audioVault.scanVolumes();
      if (volumes.length > 0 && volumes[0].newFilesCount > 0) {
        setDetectedVolume(volumes[0]);
      }
    } catch (e) {
      console.error('Failed to load AudioVault data:', e);
    }
  }

  // Draw Waveform Canvas (High-DPI Retina scaling, fine micro-bars, mirrored DAW envelope)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const displayWidth = Math.round(rect.width || canvas.width / dpr || 1000);
    const displayHeight = Math.round(rect.height || canvas.height / dpr || 120);

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const activeClip = clips.find((c) => c.id === selectedClipId);
    const activeRaw = rawFiles.find((r) => r.id === activeClip?.parentFileId);
    const rawPeaks = activeRaw?.waveformPeaks && activeRaw.waveformPeaks.length > 0
      ? activeRaw.waveformPeaks
      : mockFallbackPeaks;

    // Slot spacing: 1.6px micro-bar + 1.0px gap = 2.6px total step
    const step = 2.6;
    const totalBars = Math.max(80, Math.floor(displayWidth / step));
    const barWidth = Math.max(1.2, step - 1.0);

    // DAW style asymmetric center: 62% upper amplitude, 38% reflection
    const baselineY = Math.round(displayHeight * 0.62);
    const maxTop = Math.max(10, baselineY - 6);
    const maxBottom = Math.max(6, (displayHeight - baselineY) - 6);

    // Subtle zero-crossing guide line
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(displayWidth, baselineY);
    ctx.stroke();

    // Played gradients
    const playedTopGrad = ctx.createLinearGradient(0, 4, 0, baselineY);
    playedTopGrad.addColorStop(0, '#22d3ee');
    playedTopGrad.addColorStop(1, '#06b6d4');

    const playedBottomGrad = ctx.createLinearGradient(0, baselineY, 0, displayHeight - 4);
    playedBottomGrad.addColorStop(0, '#0891b2');
    playedBottomGrad.addColorStop(1, 'rgba(6, 182, 212, 0.25)');

    // Unplayed colors
    const unplayedTopColor = 'rgba(148, 163, 184, 0.42)';
    const unplayedBottomColor = 'rgba(100, 116, 139, 0.22)';

    // Smooth cosine interpolation function across rawPeaks
    function samplePeak(peaksArr: number[], barIdx: number, total: number): number {
      if (!peaksArr || peaksArr.length === 0) return 0.03;
      const pos = (barIdx / (total - 1)) * (peaksArr.length - 1);
      const low = Math.floor(pos);
      const high = Math.min(peaksArr.length - 1, Math.ceil(pos));
      const frac = pos - low;
      const mu = (1 - Math.cos(frac * Math.PI)) / 2;
      const base = peaksArr[low] * (1 - mu) + peaksArr[high] * mu;
      return Math.min(1.0, Math.max(0.02, base));
    }

    // Helper for rounded bar rectangles
    function drawBar(targetCtx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: number[]) {
      if (h <= 0) return;
      targetCtx.beginPath();
      if (typeof (targetCtx as any).roundRect === 'function') {
        (targetCtx as any).roundRect(x, y, w, h, radii);
      } else {
        targetCtx.rect(x, y, w, h);
      }
      targetCtx.fill();
    }

    // Render all micro-bars
    for (let i = 0; i < totalBars; i++) {
      const x = i * step;
      if (x + barWidth > displayWidth) break;

      const peakVal = samplePeak(rawPeaks, i, totalBars);
      const normPos = i / totalBars;
      const isPlayed = normPos <= playbackProgress;

      const topHeight = Math.max(2, peakVal * maxTop);
      const bottomHeight = Math.max(1, peakVal * 0.45 * maxBottom);

      // Draw top amplitude bar
      ctx.fillStyle = isPlayed ? playedTopGrad : unplayedTopColor;
      drawBar(ctx, x, baselineY - topHeight, barWidth, topHeight, [1.5, 1.5, 0, 0]);

      // Draw bottom reflection bar
      ctx.fillStyle = isPlayed ? playedBottomGrad : unplayedBottomColor;
      drawBar(ctx, x, baselineY, barWidth, bottomHeight, [0, 0, 1.5, 1.5]);
    }

    // Draw Speech Dialogue Regions and Overlays directly on the Waveform
    if (activeClip && activeClip.transcriptionChunks && activeClip.transcriptionChunks.length > 0) {
      const duration = Math.max(0.1, activeClip.endTimeSeconds - activeClip.startTimeSeconds);

      // Group adjacent chunks into continuous speech dialogue regions
      const regions: Array<{ start: number; end: number; previewText: string }> = [];
      activeClip.transcriptionChunks.forEach((c) => {
        const last = regions[regions.length - 1];
        if (last && c.timestamp[0] - last.end < 8.0) {
          last.end = Math.max(last.end, c.timestamp[1]);
          if (last.previewText.length < 50) {
            last.previewText += ' ' + c.text;
          }
        } else {
          regions.push({
            start: c.timestamp[0],
            end: c.timestamp[1],
            previewText: c.text,
          });
        }
      });

      regions.forEach((r) => {
        const normStart = Math.max(0, (r.start - activeClip.startTimeSeconds) / duration);
        const normEnd = Math.min(1, (r.end - activeClip.startTimeSeconds) / duration);
        if (normEnd <= 0 || normStart >= 1) return;

        const regX = normStart * displayWidth;
        const regW = Math.max(28, (normEnd - normStart) * displayWidth);

        // Highlight dialogue region background
        ctx.fillStyle = 'rgba(6, 182, 212, 0.14)';
        ctx.fillRect(regX, 0, regW, displayHeight);

        // Top speech marker line
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(regX, 1);
        ctx.lineTo(regX + regW, 1);
        ctx.stroke();

        // Dialogue Overlaid Pill Badge
        const pillW = Math.min(regW - 4, 180);
        if (pillW >= 32) {
          ctx.fillStyle = 'rgba(11, 17, 32, 0.9)';
          drawBar(ctx, regX + 2, 5, pillW, 17, [4, 4, 4, 4]);

          ctx.strokeStyle = 'rgba(34, 211, 238, 0.65)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(regX + 2, 5, pillW, 17, [4, 4, 4, 4]);
          } else {
            ctx.rect(regX + 2, 5, pillW, 18);
          }
          ctx.stroke();

          ctx.fillStyle = '#22d3ee';
          ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          const cleanSnippet = r.previewText.replace(/\s+/g, ' ').trim();
          const snippet = cleanSnippet.length > 24 ? cleanSnippet.slice(0, 22) + '…' : cleanSnippet;
          ctx.fillText(`🗣️ ${snippet}`, regX + 6, 17);
        }
      });
    }

    ctx.restore();
  }, [selectedClipId, rawFiles, clips, playbackProgress]);

  // Handle hardware ingest confirmation (Non-blocking pipeline)
  async function handleConfirmIngest() {
    if (!detectedVolume) return;
    const pathsToImport = detectedVolume.files.filter((f) => !f.isAlreadyImported).map((f) => f.path);

    if (window.audioVault) {
      await window.audioVault.enqueuePipelineBatch(
        pathsToImport,
        autoUnmountPref ? detectedVolume.volumePath : undefined
      );
    } else {
      // Simulate ingest in browser mode
      const newMockClip: VirtualClip = {
        id: `clip_${Date.now()}`,
        parentFileId: 'raw_new',
        title: detectedVolume.files[0]?.name || 'ZOOM0005_Imported.WAV',
        startTimeSeconds: 0,
        endTimeSeconds: 95.0,
        category: 'music',
        userTags: ['Rehearsal Take', 'SD Ingest'],
        classificationConfidence: 0.95,
        classificationSource: 'yamnet_local',
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setClips((prev) => [newMockClip, ...prev]);
      setSelectedClipId(newMockClip.id);
    }

    setDetectedVolume(null);
  }

  // Waveform click / drag region selection
  function handleWaveformMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button === 2) return; // Ignore right click for drag start
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setIsSelecting(true);
    setDragStart(pos);
    setSelectionRange({ start: pos, end: pos });
    setPlaybackProgress(pos);
    setContextMenu(null);

    if (audioRef.current && activeClip) {
      const duration = activeClip.endTimeSeconds - activeClip.startTimeSeconds;
      const targetTime = activeClip.startTimeSeconds + pos * duration;
      audioRef.current.currentTime = targetTime;
      setCurrentTimeSec(pos * duration);
    }
  }

  function handleWaveformMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isSelecting || dragStart === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const currentPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSelectionRange({
      start: Math.min(dragStart, currentPos),
      end: Math.max(dragStart, currentPos),
    });
  }

  function handleWaveformMouseUp() {
    setIsSelecting(false);
    setDragStart(null);
  }

  function handleWaveformContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }

  // Context Menu Actions
  async function handleClassifySelection(category: PrimaryCategory) {
    if (window.audioVault) {
      await window.audioVault.reclassifyClip(selectedClipId, category);
    }
    setClips((prev) =>
      prev.map((c) => (c.id === selectedClipId ? { ...c, category, updatedAt: new Date().toISOString() } : c))
    );
    setContextMenu(null);
  }

  async function handleAddTagPrompt() {
    const tagName = prompt('Enter tag name (e.g., Rehearsal, Vocal Warmup, Standup):');
    if (tagName && tagName.trim()) {
      if (window.audioVault) {
        await window.audioVault.reclassifyClip(selectedClipId, activeClip.category, tagName.trim());
      }
      setClips((prev) =>
        prev.map((c) =>
          c.id === selectedClipId
            ? { ...c, userTags: Array.from(new Set([...c.userTags, tagName.trim()])) }
            : c
        )
      );
    }
    setContextMenu(null);
  }

  function handleSplitVirtualClip() {
    if (!selectionRange || !activeClip) return;
    const startSec = Math.round(selectionRange.start * activeClip.endTimeSeconds);
    const endSec = Math.round(selectionRange.end * activeClip.endTimeSeconds);

    const splitClip: VirtualClip = {
      id: `clip_${Date.now()}`,
      parentFileId: activeClip.parentFileId,
      title: `${activeClip.title} (Cut ${startSec}s-${endSec}s)`,
      startTimeSeconds: startSec,
      endTimeSeconds: endSec,
      category: activeClip.category,
      userTags: [...activeClip.userTags, 'Virtual Segment'],
      classificationConfidence: activeClip.classificationConfidence,
      classificationSource: 'user_manual',
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (window.audioVault) {
      window.audioVault.createVirtualClip(splitClip);
    }
    setClips((prev) => [splitClip, ...prev]);
    setSelectedClipId(splitClip.id);
    setContextMenu(null);
  }

  function handleExcludeRegion() {
    setClips((prev) =>
      prev.map((c) => (c.id === selectedClipId ? { ...c, isExcluded: true } : c))
    );
    setContextMenu(null);
  }

  async function handleExportClip() {
    if (window.audioVault) {
      await window.audioVault.exportClip(selectedClipId);
    } else {
      alert(`Exported "${activeClip?.title}" to disk (simulated).`);
    }
    setContextMenu(null);
  }

  const [isTranscribingRegion, setIsTranscribingRegion] = useState(false);

  async function handleTranscribeRegion(customStartSec?: number, customEndSec?: number) {
    if (!activeClip || !window.audioVault) return;
    setIsTranscribingRegion(true);
    try {
      const clipDuration = Math.max(0.1, activeClip.endTimeSeconds - activeClip.startTimeSeconds);
      let start = activeClip.startTimeSeconds;
      let dur = 60;

      if (typeof customStartSec === 'number') {
        start = customStartSec;
        dur = typeof customEndSec === 'number' ? Math.max(2, customEndSec - customStartSec) : 60;
      } else if (selectionRange) {
        start = activeClip.startTimeSeconds + selectionRange.start * clipDuration;
        const end = activeClip.startTimeSeconds + selectionRange.end * clipDuration;
        dur = Math.max(2, end - start);
      } else {
        start = Math.max(activeClip.startTimeSeconds, activeClip.startTimeSeconds + currentTimeSec - 15);
        dur = Math.min(60, activeClip.endTimeSeconds - start);
      }

      const updated = await window.audioVault.transcribeClipRegion(activeClip.id, start, dur);
      if (updated) {
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } catch (err) {
      console.error('Failed to transcribe region with Whisper:', err);
    } finally {
      setIsTranscribingRegion(false);
      setContextMenu(null);
    }
  }

  // Filter clips by category and tag
  const filteredClips = clips.filter((c) => {
    if (c.isExcluded) return false;
    const matchesCat = selectedCategory === 'all' || c.category === selectedCategory;
    const matchesTag = !selectedTag || c.userTags.includes(selectedTag);
    return matchesCat && matchesTag;
  });

  // Sort clips by selected field and order (starts desc on createdAt / import time)
  const sortedClips = useMemo(() => {
    return [...filteredClips].sort((a, b) => {
      let diff = 0;
      if (sortField === 'title') {
        diff = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'category') {
        diff = a.category.localeCompare(b.category);
      } else if (sortField === 'duration') {
        const durA = a.endTimeSeconds - a.startTimeSeconds;
        const durB = b.endTimeSeconds - b.startTimeSeconds;
        diff = durA - durB;
      } else if (sortField === 'tags') {
        const tagsA = a.userTags.join(', ');
        const tagsB = b.userTags.join(', ');
        diff = tagsA.localeCompare(tagsB);
      } else if (sortField === 'confidence') {
        diff = a.classificationConfidence - b.classificationConfidence;
      } else if (sortField === 'createdAt') {
        const timeA = new Date(a.createdAt).getTime() || 0;
        const timeB = new Date(b.createdAt).getTime() || 0;
        diff = timeA - timeB;
      }
      return sortOrder === 'asc' ? diff : -diff;
    });
  }, [filteredClips, sortField, sortOrder]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // Default to desc for createdAt, duration, and confidence; asc for text
      setSortOrder(field === 'createdAt' || field === 'duration' || field === 'confidence' ? 'desc' : 'asc');
    }
  }

  function renderSortIndicator(field: SortField) {
    if (sortField === field) {
      return (
        <span style={{ marginLeft: '6px', color: 'var(--accent-cyan)', fontSize: '0.8rem', display: 'inline-block' }}>
          {sortOrder === 'asc' ? '▲' : '▼'}
        </span>
      );
    }
    return (
      <span style={{ marginLeft: '6px', color: 'var(--text-muted)', opacity: 0.35, fontSize: '0.8rem', display: 'inline-block' }}>
        ↕
      </span>
    );
  }

  function formatCreationDate(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}`;
  }

  const allTags = Array.from(new Set(clips.flatMap((c) => c.userTags)));

  return (
    <div className="app-container" onClick={() => contextMenu && setContextMenu(null)}>
      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">🎙️</div>
          <div>
            <div className="brand-title">AudioVault</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Hardware Field Recorder Ingestion & Non-Destructive Classifier
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              if (window.audioVault) {
                const vols = await window.audioVault.scanVolumes();
                if (vols.length > 0) setDetectedVolume(vols[0]);
                else alert('No external audio volumes detected.');
              } else {
                setDetectedVolume({
                  volumePath: '/Volumes/EOS_DIGITAL',
                  volumeName: 'EOS_DIGITAL (Zoom SD)',
                  totalFilesCount: 8,
                  newFilesCount: 3,
                  files: [
                    { path: '/Volumes/EOS_DIGITAL/ZOOM0005.WAV', name: 'ZOOM0005.WAV', sizeBytes: 15400000, modifiedTime: new Date().toISOString(), volumePath: '/Volumes/EOS_DIGITAL', volumeName: 'EOS_DIGITAL', isAlreadyImported: false },
                  ],
                });
              }
            }}
          >
            🔍 Scan Connected Drives
          </button>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              if (window.audioVault) {
                const res = await window.audioVault.selectAndImport();
                if (res && res.count > 0) {
                  alert(`Enqueued ${res.count} audio takes for serial ingest & local Whisper transcription!`);
                }
              }
            }}
          >
            📥 Import Folder / SD Card
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (window.audioVault) {
                const dir = await window.audioVault.selectVaultDirectory();
                if (dir) alert(`Storage vault configured: ${dir}`);
              }
            }}
          >
            📁 Storage Vault
          </button>
        </div>
      </header>

      {/* Hardware Ingest Notification Banner */}
      {detectedVolume && (
        <div className="ingest-banner">
          <div className="banner-left">
            <span style={{ fontSize: '1.2rem' }}>⚡</span>
            <div>
              <div style={{ fontWeight: 600 }}>External Audio Media Detected: {detectedVolume.volumeName}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Found {detectedVolume.newFilesCount} new takes ready to ingest ({detectedVolume.totalFilesCount} total files on media)
              </div>
            </div>
          </div>
          <div className="banner-controls">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoUnmountPref}
                onChange={(e) => {
                  setAutoUnmountPref(e.target.checked);
                  if (window.audioVault) {
                    window.audioVault.updateVaultSettings({ autoUnmountAfterIngest: e.target.checked });
                  }
                }}
              />
              Cleanly unmount card after download
            </label>
            <button className="btn btn-primary" onClick={handleConfirmIngest}>
              Import New Takes
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDetectedVolume(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Live Pipeline Progress Tray (Non-blocking background pipeline) */}
      {pipelineStatus && (pipelineStatus.activeCopyJob || pipelineStatus.activeAnalysisJobs.length > 0 || pipelineStatus.canUnmountSdCard) && (
        <div className="pipeline-tray">
          <div className="pipeline-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontWeight: 600 }}>Pipeline Activity</span>
              {pipelineStatus.isSdCardActive ? (
                <span className="pipeline-status-badge badge-serial">
                  ⚡ SD Card Read (Sequential: 1 active)
                </span>
              ) : pipelineStatus.canUnmountSdCard ? (
                <span className="pipeline-status-badge badge-unmounted">
                  ✓ SD Card Read Finished — Safely Ejected!
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Completed: {pipelineStatus.completedJobs} / {pipelineStatus.totalJobs}
            </div>
          </div>

          {/* Active Serial Copy Progress */}
          {pipelineStatus.activeCopyJob && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                <span>Copying: {pipelineStatus.activeCopyJob.filename}</span>
                <span>{pipelineStatus.activeCopyJob.copyPercent}% ({Math.round(pipelineStatus.activeCopyJob.bytesCopied / 1024)} KB)</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${pipelineStatus.activeCopyJob.copyPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Active Parallel Analysis Workers */}
          {pipelineStatus.activeAnalysisJobs.length > 0 && (
            <div className="worker-pills-row">
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Local SSD Workers:</span>
              {pipelineStatus.activeAnalysisJobs.map((job: IngestJobProgress) => (
                <div key={job.jobId} className="worker-pill">
                  <span>🧠 {job.filename}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>{job.analysisPercent}%</span>
                </div>
              ))}
            </div>
          )}

          {pipelineStatus.unmountMessage && (
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', fontWeight: 500 }}>
              {pipelineStatus.unmountMessage}
            </div>
          )}
        </div>
      )}

      {/* Main Studio Body */}
      <div className="app-body">
        {/* Sidebar Navigation */}
        <aside className="app-sidebar">
          <div className="nav-section">
            <div className="nav-header">Primary Taxonomy</div>
            <div
              className={`nav-item ${selectedCategory === 'all' && !selectedTag ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('all'); setSelectedTag(null); }}
            >
              <span>Library (All)</span>
              <span className="counter-pill">{clips.filter((c) => !c.isExcluded).length}</span>
            </div>
            <div
              className={`nav-item ${selectedCategory === 'music' ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('music'); setSelectedTag(null); }}
            >
              <span>🎵 Music & Singing</span>
              <span className="counter-pill">{clips.filter((c) => c.category === 'music' && !c.isExcluded).length}</span>
            </div>
            <div
              className={`nav-item ${selectedCategory === 'concerts' ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('concerts'); setSelectedTag(null); }}
            >
              <span>🎸 Concerts & Live</span>
              <span className="counter-pill">{clips.filter((c) => c.category === 'concerts' && !c.isExcluded).length}</span>
            </div>
            <div
              className={`nav-item ${selectedCategory === 'dictaphone' ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('dictaphone'); setSelectedTag(null); }}
            >
              <span>🎙️ Dictaphone Memos</span>
              <span className="counter-pill">{clips.filter((c) => c.category === 'dictaphone' && !c.isExcluded).length}</span>
            </div>
            <div
              className={`nav-item ${selectedCategory === 'meeting' ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('meeting'); setSelectedTag(null); }}
            >
              <span>👥 Meetings</span>
              <span className="counter-pill">{clips.filter((c) => c.category === 'meeting' && !c.isExcluded).length}</span>
            </div>
            <div
              className={`nav-item ${selectedCategory === 'ambient' ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('ambient'); setSelectedTag(null); }}
            >
              <span>🌿 Ambient & Sounds</span>
              <span className="counter-pill">{clips.filter((c) => c.category === 'ambient' && !c.isExcluded).length}</span>
            </div>

            <div className="nav-header" style={{ marginTop: '1rem' }}>User Sub-Tags</div>
            <div className="tags-cloud">
              {allTags.map((tag) => (
                <span
                  key={tag}
                  className={`tag-chip ${selectedTag === tag ? 'active' : ''}`}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <div>Local AI: <strong>YAMNet + Whisper</strong></div>
            <div>Raw Audio: <strong>Non-Destructive</strong></div>
          </div>
        </aside>

        {/* Studio Workspace */}
        <main className="app-workspace">
          {/* Top Pane: Virtual Clips Table */}
          <div className="clips-pane">
            <div className="table-header-row">
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.15rem' }}>
                Virtual Clips ({filteredClips.length})
              </h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Right-click waveform selection to categorize or split
              </span>
            </div>

            <table className="clips-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('title')} title="Click to sort by Clip Title">
                    Clip Title {renderSortIndicator('title')}
                  </th>
                  <th onClick={() => handleSort('category')} title="Click to sort by Category">
                    Category {renderSortIndicator('category')}
                  </th>
                  <th onClick={() => handleSort('duration')} title="Click to sort by Duration">
                    Duration {renderSortIndicator('duration')}
                  </th>
                  <th onClick={() => handleSort('tags')} title="Click to sort by Sub-Tags">
                    Sub-Tags {renderSortIndicator('tags')}
                  </th>
                  <th onClick={() => handleSort('confidence')} title="Click to sort by Local AI Signal">
                    Local AI Signal {renderSortIndicator('confidence')}
                  </th>
                  <th onClick={() => handleSort('createdAt')} title="Click to sort by Creation / Import Time">
                    Created / Recorded {renderSortIndicator('createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedClips.map((clip) => (
                  <tr
                    key={clip.id}
                    className={clip.id === selectedClipId ? 'selected' : ''}
                    onClick={() => setSelectedClipId(clip.id)}
                  >
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{clip.title}</div>
                      {clip.transcription && (
                        <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', fontStyle: 'italic' }}>
                          {clip.transcription}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`category-pill cat-${clip.category}`}>
                        {clip.category.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {(clip.endTimeSeconds - clip.startTimeSeconds).toFixed(1)}s
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {clip.userTags.map((t, idx) => (
                          <span key={idx} className="tag-chip" style={{ fontSize: '0.7rem' }}>
                            #{t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {clip.classificationSource === 'yamnet_local' ? 'YAMNet (' : 'Whisper ('}
                        {Math.round(clip.classificationConfidence * 100)}%)
                      </span>
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {formatCreationDate(clip.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom Pane: Waveform Scrubber Dock */}
          <div className="waveform-dock">
            <div className="dock-header">
              <div className="clip-title-display">
                <span className={`category-pill cat-${activeClip.category}`}>
                  {activeClip.category}
                </span>
                <span>{activeClip.title}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  [{activeClip.startTimeSeconds.toFixed(1)}s - {activeClip.endTimeSeconds.toFixed(1)}s]
                </span>
              </div>

              <div className="transport-controls">
                <button
                  className="play-btn"
                  onClick={() => setIsPlaying(!isPlaying)}
                  title="Play / Pause Spacebar"
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPlaybackProgress(0)}
                  title="Return to Start"
                >
                  ⏮
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {Math.floor(currentTimeSec / 60).toString().padStart(2, '0')}:{(Math.floor(currentTimeSec % 60)).toString().padStart(2, '0')} / {Math.floor((activeClip.endTimeSeconds - activeClip.startTimeSeconds) / 60).toString().padStart(2, '0')}:{(Math.floor((activeClip.endTimeSeconds - activeClip.startTimeSeconds) % 60)).toString().padStart(2, '0')}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const nextCat: PrimaryCategory =
                      activeClip.category === 'music'
                        ? 'concerts'
                        : activeClip.category === 'concerts'
                        ? 'dictaphone'
                        : activeClip.category === 'dictaphone'
                        ? 'meeting'
                        : 'music';
                    handleClassifySelection(nextCat);
                  }}
                >
                  Change Category ▾
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleExportClip}>
                  💾 Export WAV
                </button>
              </div>
            </div>

            {/* Hidden HTML5 Audio Element for real native audio playback */}
            <audio
              ref={audioRef}
              src={`audiovault://file/${activeClip.parentFileId}`}
              onTimeUpdate={() => {
                if (audioRef.current && activeClip) {
                  const duration = activeClip.endTimeSeconds - activeClip.startTimeSeconds;
                  const current = Math.max(0, audioRef.current.currentTime - activeClip.startTimeSeconds);
                  setCurrentTimeSec(current);
                  if (duration > 0) {
                    setPlaybackProgress(Math.min(1, current / duration));
                  }
                }
              }}
              onEnded={() => {
                setIsPlaying(false);
                setPlaybackProgress(0);
                setCurrentTimeSec(0);
              }}
            />

            {/* Interactive Waveform Canvas Container */}
            <div
              className="waveform-canvas-container"
              onMouseDown={handleWaveformMouseDown}
              onMouseMove={handleWaveformMouseMove}
              onMouseUp={handleWaveformMouseUp}
              onContextMenu={handleWaveformContextMenu}
            >
              <canvas
                ref={canvasRef}
                className="waveform-canvas"
                width={1200}
                height={120}
              />

              {/* Selection Highlight Box */}
              {selectionRange && (
                <div
                  className="selection-overlay"
                  style={{
                    left: `${selectionRange.start * 100}%`,
                    width: `${(selectionRange.end - selectionRange.start) * 100}%`,
                  }}
                />
              )}

              {/* Playback Needle */}
              <div
                className="playback-head"
                style={{ left: `${playbackProgress * 100}%` }}
              />
            </div>

            {/* Synchronized Scrolling Transcript Ribbon */}
            <div className="transcript-ribbon" data-testid="transcript-ribbon">
              <div className="transcript-ribbon-badge">
                <span>🗣️ Speech</span>
              </div>
              <div className="transcript-scroll-viewport" ref={transcriptScrollRef}>
                {activeWords.length > 0 ? (
                  <div className="transcript-track">
                    {activeWords.map((item, idx) => {
                      const isSpoken = currentTimeSec > item.endSec;
                      const isActive = idx === activeWordIndex;

                      let statusClass = 'upcoming';
                      if (isActive) statusClass = 'active';
                      else if (isSpoken) statusClass = 'spoken';

                      return (
                        <span
                          key={item.id}
                          ref={(el) => (wordRefs.current[idx] = el)}
                          className={`transcript-word ${statusClass}`}
                          onClick={() => handleSeekToWord(item.startSec)}
                          title={`Click to seek to ${Math.floor(item.startSec / 60)}:${(Math.floor(item.startSec % 60)).toString().padStart(2, '0')}`}
                        >
                          {item.word}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div className="transcript-empty-notice">
                    <span>
                      {activeClip.category === 'music' || activeClip.category === 'concerts'
                        ? '🎵 Instrumental passage — No dialogue detected in initial scan'
                        : '🎙️ No speech indexed yet'}
                    </span>
                    <button
                      className="btn btn-sm"
                      style={{
                        background: 'rgba(6, 182, 212, 0.2)',
                        border: '1px solid var(--accent-cyan)',
                        color: '#22d3ee',
                        fontSize: '0.74rem',
                        padding: '0.2rem 0.65rem',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginLeft: '0.5rem',
                      }}
                      onClick={() => handleTranscribeRegion()}
                      disabled={isTranscribingRegion}
                    >
                      {isTranscribingRegion
                        ? '⏳ Detecting with Whisper...'
                        : selectionRange
                        ? '🎙️ Detect Speech in Selection'
                        : '🎙️ Scan for Speech Here'}
                    </button>
                  </div>
                )}
              </div>

              {/* Jump to upcoming dialogue button when in an instrumental section */}
              {activeWords.length > 0 && nextSpeechStart !== null && activeWordIndex === -1 && (
                <button
                  className="btn btn-sm"
                  style={{
                    background: 'rgba(6, 182, 212, 0.15)',
                    border: '1px solid rgba(6, 182, 212, 0.4)',
                    color: '#22d3ee',
                    fontSize: '0.72rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    marginLeft: 'auto',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                  onClick={() => handleSeekToWord(nextSpeechStart)}
                  title="Jump directly to the next detected speech section"
                >
                  Jump to Speech ({Math.floor(nextSpeechStart / 60)}:{(Math.floor(nextSpeechStart % 60)).toString().padStart(2, '0')}) ⏩
                </button>
              )}

              {/* Action to transcribe custom selection */}
              {selectionRange && (
                <button
                  className="btn btn-sm"
                  style={{
                    background: 'rgba(6, 182, 212, 0.2)',
                    border: '1px solid var(--accent-cyan)',
                    color: '#22d3ee',
                    fontSize: '0.72rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '4px',
                    marginLeft: activeWords.length > 0 ? '0.5rem' : 'auto',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                  onClick={() => handleTranscribeRegion()}
                  disabled={isTranscribingRegion}
                >
                  {isTranscribingRegion ? '⏳ Scanning...' : '🎙️ Transcribe Selection'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              <span>Click waveform or word to seek &bull; Drag cursor to select virtual region &bull; Right-click for context actions</span>
              <span>Selection: {selectionRange ? `${(selectionRange.start * (activeClip.endTimeSeconds - activeClip.startTimeSeconds)).toFixed(1)}s – ${(selectionRange.end * (activeClip.endTimeSeconds - activeClip.startTimeSeconds)).toFixed(1)}s` : 'None'}</span>
            </div>
          </div>
        </main>
      </div>

      {/* Floating Right-Click Context Menu */}
      {contextMenu && contextMenu.visible && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}
            onClick={() => handleTranscribeRegion()}
          >
            🎙️ Transcribe Region with Whisper
          </div>
          <div className="context-divider" />
          <div className="context-menu-item" onClick={() => handleClassifySelection('music')}>
            🎵 Classify as Music
          </div>
          <div className="context-menu-item" onClick={() => handleClassifySelection('concerts')}>
            🎸 Classify as Concert
          </div>
          <div className="context-menu-item" onClick={() => handleClassifySelection('meeting')}>
            👥 Classify as Meeting
          </div>
          <div className="context-menu-item" onClick={() => handleClassifySelection('dictaphone')}>
            🎙️ Classify as Dictaphone
          </div>
          <div className="context-divider" />
          <div className="context-menu-item" onClick={handleAddTagPrompt}>
            🔖 Add Custom Sub-Tag...
          </div>
          <div className="context-menu-item" onClick={handleSplitVirtualClip}>
            ✂️ Split as Virtual Clip
          </div>
          <div className="context-menu-item" onClick={handleExportClip}>
            💾 Export Region to WAV
          </div>
          <div className="context-divider" />
          <div className="context-menu-item danger" onClick={handleExcludeRegion}>
            🗑️ Exclude / Delete Region
          </div>
        </div>
      )}
    </div>
  );
}
