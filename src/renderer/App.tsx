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

/**
 * Accessible, high-contrast search highlight component using semantic <mark>.
 */
function HighlightMatch({
  text,
  query,
  className,
}: {
  text?: string | null;
  query?: string;
  className?: string;
}) {
  if (!text) return null;
  if (!query || !query.trim()) {
    return <span className={className}>{text}</span>;
  }

  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  if (parts.length <= 1) {
    return <span className={className}>{text}</span>;
  }

  const qLower = q.toLowerCase();
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === qLower ? (
          <mark key={i} className="search-highlight-mark">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
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
  const [deletedFilesCount, setDeletedFilesCount] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const activeIngestingVolumePathRef = useRef<string | null>(null);
  
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

  // Clip row right-click context menu
  const [clipContextMenu, setClipContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    clip: VirtualClip;
  } | null>(null);

  // Edit clip title and metadata modal dialog state
  const [editingMetadataClip, setEditingMetadataClip] = useState<{
    id: string;
    title: string;
    category: PrimaryCategory;
    userTags: string[];
    notes: string;
    newTagInput: string;
    isGeneratingAiTitle: boolean;
  } | null>(null);

  const [isGeneratingTitleForClipId, setIsGeneratingTitleForClipId] = useState<string | null>(null);
  const [waveformProfile, setWaveformProfile] = useState<'adaptive' | 'balanced' | 'punchy' | 'linear'>('adaptive');

  // Delete clip confirmation modal state
  const [clipToDelete, setClipToDelete] = useState<VirtualClip | null>(null);
  const [rememberDeleteChoice, setRememberDeleteChoice] = useState<boolean>(() => {
    return localStorage.getItem('audiovault_remember_delete_choice') === 'true';
  });
  const [rememberDeleteCheckbox, setRememberDeleteCheckbox] = useState<boolean>(false);

  // Direction 1 & 2: Search and In-App Recording State
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedSource, setSelectedSource] = useState<'all' | 'in-app' | 'sd-card' | 'import-folder'>('all');

  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState<number[]>([15, 25, 45, 60, 35, 20, 10, 30, 50, 65, 40, 25, 15, 45, 70, 55, 30, 20]);
  const [autoTranscribeOnStop, setAutoTranscribeOnStop] = useState(true);

  // In-app audio capture refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const recordedPcmChunksRef = useRef<Float32Array[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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
        // Skip popup if this volume is already being actively ingested
        if (
          activeIngestingVolumePathRef.current &&
          event.volumePath === activeIngestingVolumePathRef.current
        ) {
          return;
        }
        setDetectedVolume(event);
      });
      const unsubscribePipeline = window.audioVault.onPipelineStatus((status) => {
        setPipelineStatus(status);
        if (
          status &&
          !status.isSdCardActive &&
          !status.activeCopyJob &&
          (!status.activeAnalysisJobs || status.activeAnalysisJobs.length === 0)
        ) {
          activeIngestingVolumePathRef.current = null;
        }
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

  // Global Keyboard Shortcuts (Space to Play/Pause, Arrow keys to Seek, Cmd+K to Search)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

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

  // Convert Float32Array PCM samples into a valid 16-bit 48kHz WAV ArrayBuffer
  function encodeWav(samples: Float32Array, sampleRate = 48000): ArrayBuffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = samples.length * (bitsPerSample / 8);
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);

    // PCM samples (float32 to signed int16)
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return buffer;
  }

  // Start In-App Recording
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

      mediaStreamRef.current = stream;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000,
      });
      audioContextRef.current = audioCtx;

      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      // Collect PCM chunks with ScriptProcessor
      const scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptNode;
      recordedPcmChunksRef.current = [];

      scriptNode.onaudioprocess = (e) => {
        if (isRecordingPaused) return;
        const inputData = e.inputBuffer.getChannelData(0);
        recordedPcmChunksRef.current.push(new Float32Array(inputData));
      };

      sourceNode.connect(analyser);
      analyser.connect(scriptNode);
      scriptNode.connect(audioCtx.destination);

      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingDuration(0);

      // Duration counter
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      // Level meter visualizer loop
      const updateMeter = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);

          // Downsample to 18 bars
          const bars: number[] = [];
          const step = Math.max(1, Math.floor(dataArray.length / 18));
          for (let i = 0; i < 18; i++) {
            const val = dataArray[i * step] || 0;
            bars.push(Math.max(8, Math.round((val / 255) * 100)));
          }
          setRecordingLevels(bars);
        }
        animationFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      alert('Could not access microphone: ' + (err.message || String(err)));
    }
  }

  function pauseRecording() {
    setIsRecordingPaused((prev) => !prev);
  }

  async function stopRecording() {
    if (!isRecording) return;

    // Clean up streams & audio nodes
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setIsRecording(false);
    setIsRecordingPaused(false);

    // Merge PCM chunks
    const chunks = recordedPcmChunksRef.current;
    let totalLength = 0;
    for (const c of chunks) totalLength += c.length;

    if (totalLength === 0) {
      alert('Recording was empty or too short.');
      return;
    }

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const wavBuffer = encodeWav(merged, 48000);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const takeTitle = `In-App Take · ${timeStr}`;

    try {
      if (window.audioVault) {
        const newClip = await window.audioVault.saveRecordedTake(wavBuffer, takeTitle, autoTranscribeOnStop);
        if (newClip) {
          setClips((prev) => {
            const exists = prev.some((c) => c.id === newClip.id);
            return exists ? prev.map((c) => (c.id === newClip.id ? newClip : c)) : [newClip, ...prev];
          });
          setSelectedClipId(newClip.id);
        }
      } else {
        // Mock fallback clip
        const mockNew: VirtualClip = {
          id: `clip_${Date.now()}`,
          parentFileId: `raw_${Date.now()}`,
          title: takeTitle,
          startTimeSeconds: 0,
          endTimeSeconds: Math.max(1, recordingDuration),
          category: 'dictaphone',
          userTags: ['In-App Take', 'Voice Memo'],
          classificationConfidence: 0.95,
          classificationSource: 'yamnet_local',
          isExcluded: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setClips((prev) => [mockNew, ...prev]);
        setSelectedClipId(mockNew.id);
      }
    } catch (e: any) {
      console.error('Error saving recorded take:', e);
      alert('Failed to save recorded take: ' + (e.message || String(e)));
    }
  }

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

      if (window.audioVault.getDeletedFiles) {
        const deleted = await window.audioVault.getDeletedFiles();
        setDeletedFilesCount(deleted.length);
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

    // Profile tuning parameters for decimation and amplitude contour
    let step = 2.6;
    let gamma = 0.65;
    let headroomFloor = 0.12;
    let scaleHeadroom = true;
    let peakWeight = 0.84;
    let meanWeight = 0.16;

    if (waveformProfile === 'balanced') {
      step = 2.8;
      gamma = 0.76;
      headroomFloor = 0.22;
      scaleHeadroom = true;
      peakWeight = 0.80;
      meanWeight = 0.20;
    } else if (waveformProfile === 'punchy') {
      step = 3.0;
      gamma = 0.52;
      headroomFloor = 0.10;
      scaleHeadroom = true;
      peakWeight = 0.88;
      meanWeight = 0.12;
    } else if (waveformProfile === 'linear') {
      step = 2.6;
      gamma = 1.0;
      headroomFloor = 1.0;
      scaleHeadroom = false;
      peakWeight = 1.0;
      meanWeight = 0.0;
    }

    const totalBars = Math.max(80, Math.floor(displayWidth / step));
    const barWidth = Math.max(1.2, step - 1.0);

    // DAW style asymmetric center: 62% upper amplitude, 38% reflection
    const baselineY = Math.round(displayHeight * 0.62);
    const maxTop = Math.max(10, baselineY - 6);
    const maxBottom = Math.max(6, (displayHeight - baselineY) - 6);

    // Compute track maximum peak for adaptive headroom expansion
    let trackMax = 0.01;
    for (let p = 0; p < rawPeaks.length; p++) {
      if (rawPeaks[p] > trackMax) trackMax = rawPeaks[p];
    }
    const effectiveCeiling = scaleHeadroom ? Math.max(headroomFloor, trackMax) : 1.0;

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

    // Bucket extraction across rawPeaks with transient & body preservation
    function sampleBucketPeak(barIdx: number): number {
      if (!rawPeaks || rawPeaks.length === 0) return 0.03;
      const numPeaks = rawPeaks.length;
      let rawVal = 0;

      if (totalBars <= numPeaks) {
        // When decimating (reducing): collect all points within this bar's bucket window
        const start = Math.floor((barIdx / totalBars) * numPeaks);
        const end = Math.min(numPeaks, Math.max(start + 1, Math.ceil(((barIdx + 1) / totalBars) * numPeaks)));
        let bMax = 0;
        let sum = 0;
        let count = 0;
        for (let j = start; j < end; j++) {
          const v = rawPeaks[j];
          if (v > bMax) bMax = v;
          sum += v;
          count++;
        }
        const bMean = count > 0 ? sum / count : bMax;
        rawVal = bMax * peakWeight + bMean * meanWeight;
      } else {
        // When expanding: smooth cosine interpolation
        const pos = (barIdx / (totalBars - 1)) * (numPeaks - 1);
        const low = Math.floor(pos);
        const high = Math.min(numPeaks - 1, Math.ceil(pos));
        const frac = pos - low;
        const mu = (1 - Math.cos(frac * Math.PI)) / 2;
        rawVal = rawPeaks[low] * (1 - mu) + rawPeaks[high] * mu;
      }

      // Normalization / Headroom scaling
      const normalized = Math.min(1.0, rawVal / effectiveCeiling);
      // Perceptual companding curve (gamma)
      const curved = Math.pow(Math.max(0, normalized), gamma);
      return Math.min(1.0, Math.max(0.015, curved));
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

    // Render all micro-bars with grown decimation buckets
    for (let i = 0; i < totalBars; i++) {
      const x = i * step;
      if (x + barWidth > displayWidth) break;

      const peakVal = sampleBucketPeak(i);
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
  }, [selectedClipId, rawFiles, clips, playbackProgress, waveformProfile]);

  // Handle hardware ingest confirmation (Non-blocking pipeline)
  async function handleConfirmIngest() {
    if (!detectedVolume) return;
    const volPath = detectedVolume.volumePath;
    activeIngestingVolumePathRef.current = volPath;

    const pathsToImport = detectedVolume.files
      .filter((f) => !f.isAlreadyImported && !f.isDeleted)
      .map((f) => f.path);

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
    const estimatedMenuWidth = 240;
    const estimatedMenuHeight = 440;
    const x = Math.max(12, Math.min(e.clientX, window.innerWidth - estimatedMenuWidth - 12));
    const y = e.clientY + estimatedMenuHeight > window.innerHeight
      ? Math.max(12, window.innerHeight - estimatedMenuHeight - 12)
      : Math.max(12, e.clientY);
    setContextMenu({
      visible: true,
      x,
      y,
    });
    setClipContextMenu(null);
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

  function handlePromptDeleteClip(clip: VirtualClip) {
    if (rememberDeleteChoice) {
      executeDeleteClip(clip);
    } else {
      setRememberDeleteCheckbox(false);
      setClipToDelete(clip);
    }
  }

  async function executeDeleteClip(clip: VirtualClip) {
    try {
      if (window.audioVault) {
        await window.audioVault.deleteVirtualClip(clip.id, true);
      }
      setClips((prev) => prev.filter((c) => c.id !== clip.id));

      if (selectedClipId === clip.id) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        setIsPlaying(false);
        const remaining = clips.filter((c) => c.id !== clip.id);
        if (remaining.length > 0) {
          setSelectedClipId(remaining[0].id);
        }
      }

      if (window.audioVault?.getDeletedFiles) {
        const deleted = await window.audioVault.getDeletedFiles();
        setDeletedFilesCount(deleted.length);
      }
    } catch (err: any) {
      console.error('Failed to delete clip:', err);
      alert('Failed to delete clip: ' + (err.message || String(err)));
    }
  }

  async function handleConfirmDelete() {
    if (!clipToDelete) return;
    const clip = clipToDelete;
    if (rememberDeleteCheckbox) {
      localStorage.setItem('audiovault_remember_delete_choice', 'true');
      setRememberDeleteChoice(true);
      if (window.audioVault) {
        window.audioVault.updateVaultSettings({ rememberDeleteChoice: true });
      }
    }
    setClipToDelete(null);
    await executeDeleteClip(clip);
  }

  const [isExportingMp3, setIsExportingMp3] = useState<string | null>(null);

  async function handleExportClipMp3(clip: VirtualClip, isSelection: boolean = false) {
    setContextMenu(null);
    setClipContextMenu(null);
    if (!window.audioVault) {
      alert(`Exporting MP3 for "${clip.title}" (simulated)`);
      return;
    }
    setIsExportingMp3(clip.id);
    try {
      let start: number | undefined = undefined;
      let dur: number | undefined = undefined;

      if (isSelection && selectionRange && clip.id === selectedClipId) {
        const clipDuration = Math.max(0.1, clip.endTimeSeconds - clip.startTimeSeconds);
        start = clip.startTimeSeconds + selectionRange.start * clipDuration;
        const end = clip.startTimeSeconds + selectionRange.end * clipDuration;
        dur = Math.max(0.1, end - start);
      }

      const res = await window.audioVault.exportClipMp3(clip.id, start, dur);
      if (res && res.clip) {
        setClips((prev) => prev.map((c) => (c.id === res.clip.id ? res.clip : c)));
      }
    } catch (err) {
      console.error('Failed to export clip to MP3:', err);
      alert(`Export to MP3 failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExportingMp3(null);
    }
  }

  function getClipStoragePath(clip: VirtualClip): string | undefined {
    if (clip.exportedMp3Path) return clip.exportedMp3Path;
    const parentRaw = rawFiles.find((r) => r.id === clip.parentFileId);
    return parentRaw?.storagePath;
  }

  async function handleShowInFinder(filePath: string) {
    if (!window.audioVault) return;
    try {
      const opened = await window.audioVault.showInFinder(filePath);
      if (!opened) {
        alert(`Could not find audio file on disk:\n${filePath}`);
      }
    } catch (err) {
      console.error('Failed to show item in Finder:', err);
    } finally {
      setContextMenu(null);
      setClipContextMenu(null);
    }
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

  // Open Metadata & Title Editor Modal
  function handleOpenMetadataModal(clip: VirtualClip) {
    setClipContextMenu(null);
    setContextMenu(null);
    setEditingMetadataClip({
      id: clip.id,
      title: clip.title,
      category: clip.category,
      userTags: [...clip.userTags],
      notes: clip.notes || '',
      newTagInput: '',
      isGeneratingAiTitle: false,
    });
  }

  // Run local LLM to generate composite title from transcript
  async function handleGenerateAiTitle(clipId: string) {
    if (!window.audioVault) return;
    setIsGeneratingTitleForClipId(clipId);
    try {
      const updated = await window.audioVault.generateAiTitle(clipId);
      if (updated) {
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to generate AI title.');
    } finally {
      setIsGeneratingTitleForClipId(null);
      setClipContextMenu(null);
    }
  }

  // Run local LLM from within the modal
  async function handleGenerateAiTitleInModal() {
    if (!editingMetadataClip || !window.audioVault) return;
    setEditingMetadataClip((prev) => (prev ? { ...prev, isGeneratingAiTitle: true } : null));
    try {
      const updated = await window.audioVault.generateAiTitle(editingMetadataClip.id);
      if (updated) {
        setEditingMetadataClip((prev) => (prev ? { ...prev, title: updated.title } : null));
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to generate AI title from transcription.');
    } finally {
      setEditingMetadataClip((prev) => (prev ? { ...prev, isGeneratingAiTitle: false } : null));
    }
  }

  // Save metadata changes to vault registry
  async function handleSaveMetadata() {
    if (!editingMetadataClip || !window.audioVault) {
      setEditingMetadataClip(null);
      return;
    }
    try {
      const updated = await window.audioVault.updateVirtualClip(editingMetadataClip.id, {
        title: editingMetadataClip.title.trim() || 'Untitled Take',
        category: editingMetadataClip.category,
        userTags: editingMetadataClip.userTags,
        notes: editingMetadataClip.notes.trim(),
      });
      if (updated) {
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
      setEditingMetadataClip(null);
    } catch (err: any) {
      alert(err.message || 'Failed to save clip metadata.');
    }
  }

  // Quick category switcher from context menu
  async function handleQuickChangeCategory(clipId: string, category: PrimaryCategory) {
    if (!window.audioVault) return;
    try {
      const updated = await window.audioVault.updateVirtualClip(clipId, { category });
      if (updated) {
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } catch (err) {
      console.error('Failed to update category:', err);
    } finally {
      setClipContextMenu(null);
    }
  }

  // Quick tag add from context menu
  async function handleQuickAddTag(clip: VirtualClip) {
    setClipContextMenu(null);
    const tag = prompt(`Add a new sub-tag to "${clip.title}":`, '');
    if (tag && tag.trim() && window.audioVault) {
      const cleanTag = tag.trim().replace(/^#/, '');
      const newTags = Array.from(new Set([...clip.userTags, cleanTag]));
      try {
        const updated = await window.audioVault.updateVirtualClip(clip.id, { userTags: newTags });
        if (updated) {
          setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }
      } catch (err) {
        console.error('Failed to add tag:', err);
      }
    }
  }

  // Copy transcription to clipboard
  async function handleCopyTranscript(clip: VirtualClip) {
    if (!clip.transcription || !clip.transcription.trim()) return;
    const cleanText = clip.transcription
      .replace(/^\[Local Whisper\]:\s*"?/, '')
      .replace(/"?$/, '')
      .trim();
    const textToCopy = cleanText || clip.transcription.trim();

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setToastMessage('📋 Transcript copied to clipboard!');
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err) {
      console.error('Failed to copy transcript to clipboard:', err);
    } finally {
      setClipContextMenu(null);
      setContextMenu(null);
    }
  }

  // Filter clips by category, tag, source, and global search query
  const filteredClips = clips.filter((c) => {
    if (c.isExcluded) return false;
    const matchesCat = selectedCategory === 'all' || c.category === selectedCategory;
    const matchesTag = !selectedTag || c.userTags.includes(selectedTag);

    // Source filtering
    const parentRaw = rawFiles.find((r) => r.id === c.parentFileId);
    const isLocalTake =
      c.userTags.includes('In-App Take') ||
      c.title.toLowerCase().includes('in-app take') ||
      (parentRaw && parentRaw.sourceDevice === 'In-App Recorder');

    if (selectedSource === 'in-app' && !isLocalTake) return false;
    if (selectedSource === 'sd-card' && isLocalTake) return false;

    // Global Search Query across Title, Transcript, Tags, and Raw Filename
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const inTitle = c.title.toLowerCase().includes(q);
      const inTranscript = (c.transcription || '').toLowerCase().includes(q);
      const inChunks = c.transcriptionChunks ? c.transcriptionChunks.some((chunk) => chunk.text.toLowerCase().includes(q)) : false;
      const inTags = c.userTags.some((tag) => tag.toLowerCase().includes(q));
      const inFilename = parentRaw ? parentRaw.originalFilename.toLowerCase().includes(q) : false;

      if (!inTitle && !inTranscript && !inChunks && !inTags && !inFilename) {
        return false;
      }
    }

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
    <div
      className="app-container"
      onClick={() => {
        if (contextMenu) setContextMenu(null);
        if (clipContextMenu) setClipContextMenu(null);
      }}
    >
      {/* Header (Studio Console with Search Bar, Source Status & Record Button) */}
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

        {/* Global Search Bar */}
        <div className="header-search-bar" onClick={() => searchInputRef.current?.focus()}>
          <span style={{ opacity: 0.6, fontSize: '0.9rem' }}>⌕</span>
          <input
            ref={searchInputRef}
            type="text"
            className="header-search-input"
            placeholder="Search clips, transcripts, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                searchInputRef.current?.blur();
              }
            }}
          />
          {searchQuery ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="search-matches-pill">
                {filteredClips.length} {filteredClips.length === 1 ? 'match' : 'matches'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchQuery('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '0 4px',
                  fontSize: '0.85rem',
                }}
                title="Clear search (Esc)"
              >
                ✕
              </button>
            </div>
          ) : (
            <span className="kbd-shortcut">⌘K</span>
          )}
        </div>

        {/* Header Action Tools */}
        <div className="header-actions">
          {detectedVolume ? (
            <span className="status-pill ready" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
              ◉ {detectedVolume.volumeName} · {detectedVolume.newFilesCount} new
            </span>
          ) : (
            <span className="status-pill inapp" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
              ◉ Mic Ready · In-App 48kHz
            </span>
          )}

          {/* Record Button */}
          {!isRecording ? (
            <button
              className="btn btn-record"
              onClick={startRecording}
              title="Start recording directly into AudioVault"
            >
              <span className="rec-pulse-dot"></span> Record
            </button>
          ) : (
            <button
              className="btn btn-danger"
              style={{ background: 'linear-gradient(135deg, #f87171, #ef4444)', border: 'none', color: '#1a0505', fontWeight: 700 }}
              onClick={stopRecording}
              title="Stop current recording and save take"
            >
              ■ Stop Recording
            </button>
          )}

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

      {/* In-App Recording Strip (recbar - Option 1.2) */}
      {isRecording && (
        <div className="recording-bar" data-testid="recording-bar">
          <div className="recbar-big-dot">●</div>
          <div>
            <div className="recbar-timer">
              {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
            </div>
            <div className="recbar-meta">
              <b>In-App Recorder</b> · 48 kHz / 16-bit PCM · saving to Vault → Memos
            </div>
          </div>

          {/* Live Level Meter Bars */}
          <div className="recbar-levels" title="Live Microphone Input Levels">
            {recordingLevels.map((lvl, idx) => (
              <div
                key={idx}
                className="recbar-lvl-bar"
                style={{
                  height: `${isRecordingPaused ? 8 : lvl}%`,
                  opacity: isRecordingPaused ? 0.35 : 1,
                }}
              />
            ))}
          </div>

          {/* Auto-transcribe checkbox toggle */}
          <label className="recbar-toggle">
            <input
              type="checkbox"
              checked={autoTranscribeOnStop}
              onChange={(e) => setAutoTranscribeOnStop(e.target.checked)}
            />
            Auto-transcribe on stop
          </label>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={pauseRecording}
          >
            {isRecordingPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            style={{ background: 'linear-gradient(135deg, #f87171, #ef4444)', border: 'none', color: '#1a0505', fontWeight: 700 }}
            onClick={stopRecording}
          >
            ■ Stop
          </button>
        </div>
      )}

      {/* Hardware Ingest Notification Banner (Suppressed if volume is actively copying/analyzing) */}
      {detectedVolume &&
        (!activeIngestingVolumePathRef.current || detectedVolume.volumePath !== activeIngestingVolumePathRef.current) &&
        (!pipelineStatus || !pipelineStatus.activeCopyJob || !detectedVolume.volumePath || !pipelineStatus.activeCopyJob.sourcePath.startsWith(detectedVolume.volumePath)) && (
        <div className="ingest-banner">
          <div className="banner-left">
            <span style={{ fontSize: '1.2rem' }}>⚡</span>
            <div>
              <div style={{ fontWeight: 600 }}>External Audio Media Detected: {detectedVolume.volumeName}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Found {detectedVolume.newFilesCount} new takes ready to ingest ({detectedVolume.totalFilesCount} total files on media
                {detectedVolume.deletedFilesCount ? `, ${detectedVolume.deletedFilesCount} previously deleted ignored` : ''})
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
          {/* Sources Section (Option 1 & 2) */}
          <div className="nav-section" style={{ marginBottom: '1.1rem' }}>
            <div className="nav-header">Sources</div>
            <div
              className={`source-item ${selectedSource === 'in-app' ? 'active' : ''}`}
              onClick={() => setSelectedSource(selectedSource === 'in-app' ? 'all' : 'in-app')}
              title="View in-app recorded takes"
            >
              <span>🎙️ In-App Recorder</span>
              {isRecording ? (
                <span className="source-badge" style={{ background: '#ef4444', color: '#fff' }}>
                  REC
                </span>
              ) : (
                <span className="source-badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                  {clips.filter((c) => c.userTags.includes('In-App Take') || c.title.toLowerCase().includes('in-app take')).length}
                </span>
              )}
            </div>

            {detectedVolume ? (
              <div
                className={`source-item ${selectedSource === 'sd-card' ? 'active' : ''}`}
                onClick={() => setSelectedSource(selectedSource === 'sd-card' ? 'all' : 'sd-card')}
                title={`External Media: ${detectedVolume.volumeName}`}
              >
                <span>💾 {detectedVolume.volumeName.split(' ')[0]}</span>
                <span className="source-badge" style={{ background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-indigo))', color: '#04121a', fontWeight: 600 }}>
                  {detectedVolume.newFilesCount} new
                </span>
              </div>
            ) : (
              <div
                className="source-item"
                style={{ opacity: 0.6 }}
                onClick={async () => {
                  if (window.audioVault) {
                    const vols = await window.audioVault.scanVolumes();
                    if (vols.length > 0) setDetectedVolume(vols[0]);
                  }
                }}
              >
                <span>💾 SD Card</span>
                <span className="source-badge" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
                  idle
                </span>
              </div>
            )}

            <div
              className="source-item"
              onClick={async () => {
                if (window.audioVault) {
                  await window.audioVault.selectAndImport();
                }
              }}
              title="Import folder or drag audio takes"
            >
              <span>📁 Import folder</span>
            </div>

            {rememberDeleteChoice && (
              <div
                style={{
                  marginTop: '0.6rem',
                  padding: '0.45rem 0.65rem',
                  background: 'rgba(239, 68, 68, 0.07)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '6px',
                  fontSize: '0.68rem',
                  color: '#fca5a5',
                  lineHeight: 1.35,
                }}
              >
                <div>⚠️ Delete confirmation skipped</div>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('audiovault_remember_delete_choice');
                    setRememberDeleteChoice(false);
                    if (window.audioVault) {
                      window.audioVault.updateVaultSettings({ rememberDeleteChoice: false });
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-cyan)',
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: '3px',
                    fontSize: '0.68rem',
                    textDecoration: 'underline',
                  }}
                >
                  Ask every time
                </button>
              </div>
            )}

            {deletedFilesCount > 0 && (
              <div
                data-testid="deleted-takes-indicator"
                style={{
                  marginTop: '0.6rem',
                  padding: '0.45rem 0.65rem',
                  background: 'rgba(56, 189, 248, 0.07)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  borderRadius: '6px',
                  fontSize: '0.68rem',
                  color: '#bae6fd',
                  lineHeight: 1.35,
                }}
              >
                <div>🛡️ {deletedFilesCount} deleted take{deletedFilesCount > 1 ? 's' : ''} remembered</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Won&apos;t re-download on sync
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (window.audioVault?.clearDeletedFiles) {
                      await window.audioVault.clearDeletedFiles();
                      setDeletedFilesCount(0);
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-cyan)',
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: '4px',
                    fontSize: '0.65rem',
                    textDecoration: 'underline',
                  }}
                  title="Clear remembered tombstones so deleted files can be re-imported if needed"
                >
                  Clear ignore list
                </button>
              </div>
            )}
          </div>

          <div className="nav-section">
            <div className="nav-header">Library</div>
            <div
              className={`nav-item ${selectedCategory === 'all' && !selectedTag && selectedSource === 'all' ? 'active' : ''}`}
              onClick={() => { setSelectedCategory('all'); setSelectedTag(null); setSelectedSource('all'); }}
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
                  <th>Status</th>
                  <th onClick={() => handleSort('createdAt')} title="Click to sort by Creation / Import Time">
                    Created / Recorded {renderSortIndicator('createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedClips.map((clip) => {
                  const parentRaw = rawFiles.find((r) => r.id === clip.parentFileId);
                  const isLocalTake =
                    clip.userTags.includes('In-App Take') ||
                    clip.title.toLowerCase().includes('in-app take') ||
                    (parentRaw && parentRaw.sourceDevice === 'In-App Recorder');
                  const sourceSub = isLocalTake
                    ? `in-app take · ${formatCreationDate(clip.createdAt)}`
                    : parentRaw
                    ? `${parentRaw.originalFilename} · ${parentRaw.sourceDevice}`
                    : `take · ${formatCreationDate(clip.createdAt)}`;

                  return (
                    <tr
                      key={clip.id}
                      className={clip.id === selectedClipId ? 'selected' : ''}
                      onClick={() => setSelectedClipId(clip.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedClipId(clip.id);
                        const estimatedMenuWidth = 260;
                        const estimatedMenuHeight = 520;
                        const x = Math.max(12, Math.min(e.clientX, window.innerWidth - estimatedMenuWidth - 12));
                        const y = e.clientY + estimatedMenuHeight > window.innerHeight
                          ? Math.max(12, window.innerHeight - estimatedMenuHeight - 12)
                          : Math.max(12, e.clientY);
                        setClipContextMenu({ visible: true, x, y, clip });
                        setContextMenu(null);
                      }}
                      title="Right-click for options (Edit Title, Add Tags, AI Title, Category)"
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            <HighlightMatch text={clip.title} query={searchQuery} />
                          </span>
                          {clip.exportedMp3Path && (
                            <span
                              className="badge-mp3"
                              title={`Exported to MP3: ${clip.exportedMp3Path}\nClick to show in Finder`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShowInFinder(clip.exportedMp3Path!);
                              }}
                            >
                              MP3
                            </span>
                          )}
                          <button
                            type="button"
                            className="icon-btn-subtle"
                            title="Edit title & metadata (or right-click row)"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenMetadataModal(clip);
                            }}
                            style={{
                              opacity: 0.5,
                              fontSize: '0.78rem',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              borderRadius: '3px',
                            }}
                          >
                            ✏️
                          </button>
                        </div>
                        <span className="take-source-sub">
                          <HighlightMatch text={sourceSub} query={searchQuery} />
                        </span>
                        {clip.transcription && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', fontStyle: 'italic', marginTop: '2px' }}>
                            <HighlightMatch text={clip.transcription} query={searchQuery} />
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
                              #<HighlightMatch text={t} query={searchQuery} />
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
                      <td>
                        <span className={`status-pill ${isLocalTake ? 'inapp' : 'ready'}`}>
                          {isLocalTake ? '● In-App' : 'Ready'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {formatCreationDate(clip.createdAt)}
                      </td>
                    </tr>
                  );
                })}
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
                <span>
                  <HighlightMatch text={activeClip.title} query={searchQuery} />
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  [{activeClip.startTimeSeconds.toFixed(1)}s - {activeClip.endTimeSeconds.toFixed(1)}s]
                </span>
              </div>

              {/* Waveform Profile Experiments Selector */}
              <div className="profile-selector-group" title="Select waveform decimation & dynamic contour profile">
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Profile:
                </span>
                {(['adaptive', 'balanced', 'punchy', 'linear'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`profile-pill-btn ${waveformProfile === mode ? 'active' : ''}`}
                    onClick={() => setWaveformProfile(mode)}
                    title={
                      mode === 'adaptive'
                        ? 'Dynamic Adaptive: Headroom scaling + perceptual companding curve (Recommended)'
                        : mode === 'balanced'
                        ? 'Balanced: Natural acoustic depth with moderate headroom scaling'
                        : mode === 'punchy'
                        ? 'Punchy: Studio companded body for speech & voice notes'
                        : 'Linear: Raw uncompressed linear PCM amplitude'
                    }
                  >
                    {mode === 'adaptive' ? '✨ Dynamic (Rec)' : mode === 'balanced' ? '🌿 Balanced' : mode === 'punchy' ? '🔥 Punchy' : '📏 Linear'}
                  </button>
                ))}
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
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleExportClipMp3(activeClip, !!selectionRange)}
                  title="Export track or selection to MP3 with ID3 metadata"
                >
                  {isExportingMp3 === activeClip.id
                    ? '⏳ Exporting...'
                    : selectionRange
                    ? '🎵 Export Selection MP3'
                    : '🎵 Export MP3'}
                </button>
                {activeClip && getClipStoragePath(activeClip) && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleShowInFinder(getClipStoragePath(activeClip)!)}
                    title={
                      activeClip.exportedMp3Path
                        ? `Open exported MP3 in Finder:\n${activeClip.exportedMp3Path}`
                        : `Open audio file in Finder:\n${getClipStoragePath(activeClip)}`
                    }
                  >
                    📂 Open in Finder
                  </button>
                )}
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
                      const isSearchMatch = searchQuery.trim()
                        ? item.word.toLowerCase().includes(searchQuery.toLowerCase().trim())
                        : false;

                      let statusClass = 'upcoming';
                      if (isActive) statusClass = 'active';
                      else if (isSpoken) statusClass = 'spoken';
                      if (isSearchMatch) statusClass += ' search-match';

                      return (
                        <span
                          key={item.id}
                          ref={(el) => (wordRefs.current[idx] = el)}
                          className={`transcript-word ${statusClass}`}
                          onClick={() => handleSeekToWord(item.startSec)}
                          title={`Click to seek to ${Math.floor(item.startSec / 60)}:${(Math.floor(item.startSec % 60)).toString().padStart(2, '0')}`}
                        >
                          <HighlightMatch text={item.word} query={searchQuery} />
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
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 8) {
              const newTop = Math.max(8, window.innerHeight - rect.height - 8);
              if (Math.abs(el.offsetTop - newTop) > 2) {
                el.style.top = `${newTop}px`;
              }
            }
            if (rect.right > window.innerWidth - 8) {
              const newLeft = Math.max(8, window.innerWidth - rect.width - 8);
              if (Math.abs(el.offsetLeft - newLeft) > 2) {
                el.style.left = `${newLeft}px`;
              }
            }
          }}
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

          {activeClip && (() => {
            const clip = activeClip;
            const parentRaw = rawFiles.find((r) => r.id === clip.parentFileId);
            const isTranscribing = Boolean(
              pipelineStatus && (
                pipelineStatus.activeCopyJob?.sourcePath === parentRaw?.storagePath ||
                pipelineStatus.activeAnalysisJobs?.some((j) => j.sourcePath === parentRaw?.storagePath)
              )
            );
            const hasTranscript = Boolean(clip.transcription && clip.transcription.trim().length > 0 && !isTranscribing);

            return (
              <div
                className={`context-menu-item ${hasTranscript ? '' : 'disabled'}`}
                aria-disabled={!hasTranscript}
                onClick={hasTranscript ? () => handleCopyTranscript(clip) : undefined}
                title={
                  isTranscribing
                    ? 'Transcription is currently being processed...'
                    : hasTranscript
                    ? 'Copy transcript to clipboard'
                    : 'No transcript available or still being processed'
                }
              >
                <span>📋</span>
                <span>
                  {isTranscribing
                    ? 'Copy Transcript (Processing...)'
                    : hasTranscript
                    ? 'Copy Transcript'
                    : 'Copy Transcript'}
                </span>
              </div>
            );
          })()}

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
          {activeClip && (
            <>
              <div
                className="context-menu-item"
                onClick={() => handleExportClipMp3(activeClip, !!selectionRange)}
              >
                {isExportingMp3 === activeClip.id
                  ? '⏳ Exporting MP3...'
                  : selectionRange
                  ? '🎵 Export Selection to MP3'
                  : activeClip.exportedMp3Path
                  ? '🔄 Re-export to MP3'
                  : '🎵 Export Track to MP3'}
              </div>
              {getClipStoragePath(activeClip) && (
                <div
                  className="context-menu-item"
                  style={{ color: 'var(--accent-amber, #fbbf24)', fontWeight: 500 }}
                  onClick={() => handleShowInFinder(getClipStoragePath(activeClip)!)}
                  title={
                    activeClip.exportedMp3Path
                      ? `Open MP3 in Finder:\n${activeClip.exportedMp3Path}`
                      : `Open audio file in Finder:\n${getClipStoragePath(activeClip)}`
                  }
                >
                  📂 Open in Finder
                </div>
              )}
            </>
          )}
          <div className="context-divider" />
          <div className="context-menu-item" onClick={handleExcludeRegion}>
            👁️ Exclude Region
          </div>
          {activeClip && (
            <div
              className="context-menu-item danger"
              style={{ color: '#ef4444', fontWeight: 600 }}
              onClick={() => {
                const c = activeClip;
                setContextMenu(null);
                handlePromptDeleteClip(c);
              }}
            >
              🗑️ Delete Clip from Disk...
            </div>
          )}
        </div>
      )}

      {/* Clip Row Right-Click Context Menu */}
      {clipContextMenu && clipContextMenu.visible && (
        <div
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 8) {
              const newTop = Math.max(8, window.innerHeight - rect.height - 8);
              if (Math.abs(el.offsetTop - newTop) > 2) {
                el.style.top = `${newTop}px`;
              }
            }
            if (rect.right > window.innerWidth - 8) {
              const newLeft = Math.max(8, window.innerWidth - rect.width - 8);
              if (Math.abs(el.offsetLeft - newLeft) > 2) {
                el.style.left = `${newLeft}px`;
              }
            }
          }}
          className="context-menu clip-context-menu"
          style={{ top: clipContextMenu.y, left: clipContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border-color)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '240px',
            }}
          >
            {clipContextMenu.clip.title}
          </div>

          <div
            className="context-menu-item"
            data-testid="ctx-edit-title"
            onClick={() => handleOpenMetadataModal(clipContextMenu.clip)}
          >
            ✏️ Edit Title & Metadata...
          </div>

          <div
            className="context-menu-item"
            data-testid="ctx-generate-ai-title"
            style={{ color: 'var(--accent-cyan)' }}
            onClick={() => handleGenerateAiTitle(clipContextMenu.clip.id)}
          >
            {isGeneratingTitleForClipId === clipContextMenu.clip.id ? (
              <span>⏳ Generating AI Title...</span>
            ) : (
              <span>🤖 Generate AI Title (Local LLM)</span>
            )}
          </div>

          {/* Copy Transcript Option */}
          {(() => {
            const clip = clipContextMenu.clip;
            const parentRaw = rawFiles.find((r) => r.id === clip.parentFileId);
            const isTranscribing = Boolean(
              pipelineStatus && (
                pipelineStatus.activeCopyJob?.sourcePath === parentRaw?.storagePath ||
                pipelineStatus.activeAnalysisJobs?.some((j) => j.sourcePath === parentRaw?.storagePath)
              )
            );
            const hasTranscript = Boolean(clip.transcription && clip.transcription.trim().length > 0 && !isTranscribing);

            return (
              <div
                className={`context-menu-item ${hasTranscript ? '' : 'disabled'}`}
                data-testid="ctx-copy-transcript"
                aria-disabled={!hasTranscript}
                onClick={hasTranscript ? () => handleCopyTranscript(clip) : undefined}
                title={
                  isTranscribing
                    ? 'Transcription is currently being processed...'
                    : hasTranscript
                    ? 'Copy full transcript text to clipboard'
                    : 'No transcript available or still being processed'
                }
              >
                <span>📋</span>
                <span>
                  {isTranscribing
                    ? 'Copy Transcript (Processing...)'
                    : hasTranscript
                    ? 'Copy Transcript'
                    : 'Copy Transcript'}
                </span>
              </div>
            );
          })()}

          <div className="context-divider" />

          {getClipStoragePath(clipContextMenu.clip) && (
            <div
              className="context-menu-item"
              data-testid="ctx-open-in-finder"
              style={{ color: 'var(--accent-amber, #fbbf24)', fontWeight: 500 }}
              onClick={() => handleShowInFinder(getClipStoragePath(clipContextMenu.clip)!)}
              title={
                clipContextMenu.clip.exportedMp3Path
                  ? `Open MP3 in Finder:\n${clipContextMenu.clip.exportedMp3Path}`
                  : `Open audio file in Finder:\n${getClipStoragePath(clipContextMenu.clip)}`
              }
            >
              📂 Open in Finder
            </div>
          )}

          <div
            className="context-menu-item"
            data-testid="ctx-export-mp3"
            onClick={() => handleExportClipMp3(clipContextMenu.clip, false)}
          >
            {isExportingMp3 === clipContextMenu.clip.id
              ? '⏳ Exporting MP3...'
              : clipContextMenu.clip.exportedMp3Path
              ? '🔄 Re-export to MP3'
              : '🎵 Export to MP3'}
          </div>

          <div className="context-divider" />

          <div
            className="context-menu-item"
            data-testid="ctx-add-tag"
            onClick={() => handleQuickAddTag(clipContextMenu.clip)}
          >
            🏷️ Add Sub-Tag...
          </div>

          <div className="context-divider" />

          <div
            style={{
              padding: '0.2rem 0.75rem',
              fontSize: '0.68rem',
              color: 'var(--text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            Change Category:
          </div>

          <div
            className="context-menu-item"
            data-testid="ctx-category-music"
            onClick={() => handleQuickChangeCategory(clipContextMenu.clip.id, 'music')}
          >
            🎵 Music
          </div>
          <div
            className="context-menu-item"
            data-testid="ctx-category-concerts"
            onClick={() => handleQuickChangeCategory(clipContextMenu.clip.id, 'concerts')}
          >
            🎸 Concerts
          </div>
          <div
            className="context-menu-item"
            data-testid="ctx-category-dictaphone"
            onClick={() => handleQuickChangeCategory(clipContextMenu.clip.id, 'dictaphone')}
          >
            🎙️ Dictaphone
          </div>
          <div
            className="context-menu-item"
            data-testid="ctx-category-meeting"
            onClick={() => handleQuickChangeCategory(clipContextMenu.clip.id, 'meeting')}
          >
            👥 Meeting
          </div>
          <div
            className="context-menu-item"
            data-testid="ctx-category-ambient"
            onClick={() => handleQuickChangeCategory(clipContextMenu.clip.id, 'ambient')}
          >
            🌲 Ambient
          </div>

          <div className="context-divider" />

          <div
            className="context-menu-item"
            data-testid="ctx-toggle-hide"
            onClick={() => {
              const c = clipContextMenu.clip;
              setClips((prev) =>
                prev.map((item) => (item.id === c.id ? { ...item, isExcluded: !item.isExcluded } : item))
              );
              setClipContextMenu(null);
            }}
          >
            {clipContextMenu.clip.isExcluded ? '🔄 Include in Library' : '👁️ Hide from Library'}
          </div>

          <div
            className="context-menu-item danger"
            data-testid="delete-clip-menu-item"
            style={{ color: '#ef4444', fontWeight: 600 }}
            onClick={() => {
              const c = clipContextMenu.clip;
              setClipContextMenu(null);
              handlePromptDeleteClip(c);
            }}
          >
            🗑️ Delete Clip from Disk...
          </div>
        </div>
      )}

      {/* Edit Clip Metadata Modal */}
      {editingMetadataClip && (
        <div
          className="modal-overlay"
          onClick={() => setEditingMetadataClip(null)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>✏️</span>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Edit Clip Title & Metadata
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingMetadataClip(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Title Input with Auto-Generate Button */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Clip Title</label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={editingMetadataClip.isGeneratingAiTitle}
                    onClick={handleGenerateAiTitleInModal}
                    title="Generate short title from transcription using local LLM"
                    style={{
                      fontSize: '0.74rem',
                      padding: '0.25rem 0.55rem',
                      color: 'var(--accent-cyan)',
                      borderColor: 'rgba(6, 182, 212, 0.3)',
                    }}
                  >
                    {editingMetadataClip.isGeneratingAiTitle ? '⏳ Generating...' : '🤖 Auto-Generate AI Title'}
                  </button>
                </div>
                <input
                  type="text"
                  className="form-input"
                  value={editingMetadataClip.title}
                  onChange={(e) =>
                    setEditingMetadataClip({ ...editingMetadataClip, title: e.target.value })
                  }
                  placeholder="e.g. 260831-185613 - Pushing Feel"
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  Hardware file name prefix is preserved; descriptive summary follows.
                </span>
              </div>

              {/* Category selector */}
              <div className="form-group">
                <label className="form-label">Primary Category</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {(['music', 'concerts', 'dictaphone', 'meeting', 'ambient'] as PrimaryCategory[]).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`category-select-pill ${editingMetadataClip.category === cat ? 'active' : ''} cat-${cat}`}
                      onClick={() => setEditingMetadataClip({ ...editingMetadataClip, category: cat })}
                    >
                      {cat.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags Manager */}
              <div className="form-group">
                <label className="form-label">Sub-Tags</label>
                <div className="tag-chips-container">
                  {editingMetadataClip.userTags.length === 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No sub-tags added yet
                    </span>
                  )}
                  {editingMetadataClip.userTags.map((tag) => (
                    <span key={tag} className="tag-chip editable">
                      #{tag}
                      <button
                        type="button"
                        onClick={() =>
                          setEditingMetadataClip({
                            ...editingMetadataClip,
                            userTags: editingMetadataClip.userTags.filter((t) => t !== tag),
                          })
                        }
                        title="Remove tag"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    value={editingMetadataClip.newTagInput}
                    onChange={(e) =>
                      setEditingMetadataClip({ ...editingMetadataClip, newTagInput: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = editingMetadataClip.newTagInput.trim().replace(/^#/, '');
                        if (val && !editingMetadataClip.userTags.includes(val)) {
                          setEditingMetadataClip({
                            ...editingMetadataClip,
                            userTags: [...editingMetadataClip.userTags, val],
                            newTagInput: '',
                          });
                        }
                      }
                    }}
                    placeholder="Add custom tag (press Enter)..."
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const val = editingMetadataClip.newTagInput.trim().replace(/^#/, '');
                      if (val && !editingMetadataClip.userTags.includes(val)) {
                        setEditingMetadataClip({
                          ...editingMetadataClip,
                          userTags: [...editingMetadataClip.userTags, val],
                          newTagInput: '',
                        });
                      }
                    }}
                  >
                    + Add Tag
                  </button>
                </div>

                {/* Preset Suggestions */}
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.45rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Suggestions:</span>
                  {['Idea', 'Vocal', 'Guitar', 'Drums', 'Keeper', 'Draft', 'FollowUp'].map((preset) => {
                    const hasTag = editingMetadataClip.userTags.includes(preset);
                    if (hasTag) return null;
                    return (
                      <button
                        key={preset}
                        type="button"
                        className="tag-suggestion-chip"
                        onClick={() =>
                          setEditingMetadataClip({
                            ...editingMetadataClip,
                            userTags: [...editingMetadataClip.userTags, preset],
                          })
                        }
                      >
                        + #{preset}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="form-group">
                <label className="form-label">Notes & Field Memo</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={editingMetadataClip.notes}
                  onChange={(e) =>
                    setEditingMetadataClip({ ...editingMetadataClip, notes: e.target.value })
                  }
                  placeholder="Add session notes, performer credits, gear setup, or lyrics..."
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingMetadataClip(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveMetadata}
              >
                💾 Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Clip Confirmation Modal */}
      {clipToDelete && (
        <div
          className="modal-overlay"
          onClick={() => setClipToDelete(null)}
          data-testid="delete-confirmation-modal"
        >
          <div
            className="modal-dialog"
            style={{ maxWidth: '480px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                <h3 style={{ margin: 0, fontSize: '1.02rem', color: '#ef4444', fontWeight: 600 }}>
                  Delete Clip & Audio File
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setClipToDelete(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ gap: '0.9rem' }}>
              <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
                Are you sure you want to permanently delete{' '}
                <strong style={{ color: '#fff' }}>"{clipToDelete.title}"</strong>?
              </p>

              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  fontSize: '0.82rem',
                  color: '#fca5a5',
                  lineHeight: 1.4,
                }}
              >
                <div>⚠️ <strong>Permanent Action:</strong></div>
                <div style={{ marginTop: '4px' }}>
                  This will remove the clip from your library and delete the audio file from disk.
                  {clipToDelete.exportedMp3Path && ' Any exported MP3 file will also be deleted.'}
                </div>
              </div>

              <div style={{ paddingTop: '0.25rem' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid="remember-choice-checkbox"
                    checked={rememberDeleteCheckbox}
                    onChange={(e) => setRememberDeleteCheckbox(e.target.checked)}
                    style={{
                      width: '16px',
                      height: '16px',
                      accentColor: '#ef4444',
                      cursor: 'pointer',
                    }}
                  />
                  <span>Remember my choice</span>
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setClipToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="confirm-delete-btn"
                style={{
                  background: '#ef4444',
                  borderColor: '#dc2626',
                  color: '#fff',
                  fontWeight: 600,
                }}
                onClick={handleConfirmDelete}
              >
                Delete from Disk
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="copy-toast" data-testid="copy-toast">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
