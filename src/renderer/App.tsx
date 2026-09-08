import React, { useEffect, useState, useRef } from 'react';
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

  // Selection range on waveform
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>({
    start: 0.15,
    end: 0.45,
  });
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);

  // Floating Context Menu
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // Draw Waveform Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const activeClip = clips.find((c) => c.id === selectedClipId);
    const activeRaw = rawFiles.find((r) => r.id === activeClip?.parentFileId);
    const peaks = activeRaw?.waveformPeaks && activeRaw.waveformPeaks.length > 0
      ? activeRaw.waveformPeaks
      : mockFallbackPeaks;

    const barWidth = width / peaks.length;
    const centerY = height / 2;

    // Draw baseline center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Draw waveform bars
    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = Math.max(3, peak * (height * 0.85));
      const normalizedPos = i / peaks.length;

      // Color based on playback progress
      if (normalizedPos <= playbackProgress) {
        ctx.fillStyle = '#06b6d4';
      } else {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      }

      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1.5), barHeight);
    });
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

  // Filter clips by category and tag
  const filteredClips = clips.filter((c) => {
    if (c.isExcluded) return false;
    const matchesCat = selectedCategory === 'all' || c.category === selectedCategory;
    const matchesTag = !selectedTag || c.userTags.includes(selectedTag);
    return matchesCat && matchesTag;
  });

  const activeClip = clips.find((c) => c.id === selectedClipId) || clips[0] || mockFallbackClips[0];
  const allTags = Array.from(new Set(clips.flatMap((c) => c.userTags)));

  return (
    <div onClick={() => contextMenu && setContextMenu(null)}>
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
                  <th>Clip Title</th>
                  <th>Category</th>
                  <th>Duration</th>
                  <th>Sub-Tags</th>
                  <th>Local AI Signal</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredClips.map((clip) => (
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
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {new Date(clip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              <span>Drag cursor on waveform to select a non-destructive region &bull; Right-click selection for context actions</span>
              <span>Selection: {selectionRange ? `${(selectionRange.start * activeClip.endTimeSeconds).toFixed(1)}s – ${(selectionRange.end * activeClip.endTimeSeconds).toFixed(1)}s` : 'None'}</span>
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
