# Specification: Hardware Audio Ingest, Non-Destructive Annotation & Local-First Classifier

**Artifact**: `docs/spec.md` (Stage 2: Design)  
**Derived From**: [`intent/intent.md`](file:///Users/cb/Documents/antigravity/blissful-hopper/intent/intent.md)  
**Status**: Ready for Product Owner Sign-off

---

## 1. System Architecture & Boundaries

```
+-----------------------------------------------------------------------------------------+
|                                    HARDWARE LAYER                                       |
|  External SD Card / Zoom Handheld Recorder / USB Audio Device (e.g. /Volumes/EOS_DIGITAL) |
+-----------------------------------------------------------------------------------------+
                                             │ (Mount Event / Manual Scan)
                                             ▼
+-----------------------------------------------------------------------------------------+
|                                ELECTRON MAIN PROCESS                                    |
|                                                                                         |
|  [VolumeWatcher & Fetcher]                                                               |
|   - Scans /Volumes/* on macOS for FAT/exFAT media with WAV/MP3 files                   |
|   - Computes file signature: hash(first 64KB + size + mtime)                            |
|   - Deduplication Engine: checks against Ingestion Vault index                           |
|   - Safe File Transfer: bit-for-bit raw copy to ~/Music/AudioVault/raw                  |
|   - Volume Unmounter: executes clean diskutil unmount (honoring user preference)       |
|                                                                                         |
|  [Audio Analysis & Local Inference Engine]                                              |
|   - FFmpeg worker: extracts duration, sample rate, channels, RMS, waveform peaks        |
|   - Silero VAD / YAMNet: on-device event detection (Speech, Singing, Music, Silence)     |
|   - Local Whisper: lightweight speech transcription providing semantic signals          |
|   - Classifier: assigns broad category (Music, Concerts, Dictaphone, Meeting)            |
|   - Cloud Connector Adapter: optional fallback for complex queries (Gemini/OpenAI)      |
|                                                                                         |
|  [Metadata & Virtual Clip Store (SQLite / JSON)]                                        |
|   - Stores raw file descriptors, virtual clips, cue points, custom user tags            |
+-----------------------------------------------------------------------------------------+
                                             │ (Typed IPC via contextBridge)
                                             ▼
+-----------------------------------------------------------------------------------------+
|                              RENDERER PROCESS (React UI)                                |
|                                                                                         |
|  - Auto-Detect Ingestion Toast / Modal ("Import X files from Zoom H4n?")                 |
|  - Ingest Preferences ("Cleanly unmount volume when finished" + remember preference)    |
|  - Category Library (Music, Concerts, Dictaphone, Meeting, + User Tags)                  |
|  - Interactive Waveform Viewer (scrub, play/pause, loop, zoom)                          |
|  - Region Selector & Context Menu:                                                      |
|      * Right-click selection -> Classify / Tag / Split Virtual Clip / Exclude / Export   |
|  - Active Learning Dialog: prompt user on ambiguous classification                      |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Ingestion & Fetcher Subsystem

### 2.1 Volume Auto-Detection & Scanning
- **macOS Watcher**: Polls `/Volumes` and listens for mount/unmount notifications using `fs.watch('/Volumes')` and native system calls (`diskutil info`).
- **Media Evaluation**: Inspects mounted drives for root-level or nested `.wav` / `.mp3` / `.m4a` files. Specifically detects typical recorder folder schemes (e.g., `ZOOM0001.WAV`, `FOLDER01/`, `RECORD/`).
- **User Prompt**: If new audio files are found, dispatches an IPC event to Renderer:
  ```ts
  interface VolumeDetectedEvent {
    volumePath: string;
    volumeName: string;
    totalFiles: number;
    newFilesCount: number;
    newFiles: DiscoveredAudioFile[];
  }
  ```

### 2.2 Deduplication Cache
- Handheld recorders reuse file names (e.g., `ZOOM0001.WAV`). Files are uniquely fingerprinted using:
  `fingerprint = sha256(fileHeaderBytes[0..65536] + fileSize + modifiedTimestamp + volumeUUID)`
- If a file fingerprint already exists in the local database, it is flagged as `already_imported`, avoiding redundant file copies.

### 2.3 Safe Ingest & Clean Unmount
- Ingestion copies files to the user-configurable vault path (default: `~/Music/AudioVault/raw/<YYYY-MM>/`).
- **Clean Unmount**:
  - Once copy verification succeeds, if user has enabled auto-unmount, executes `diskutil unmount /Volumes/<name>`.
  - Sends feedback to UI: *"SD Card cleanly unmounted. Safe to remove."*

---

## 3. Non-Destructive Metadata Vault

Raw audio files remain **100% pristine and immutable**. All edits, tags, and cuts are represented as **Virtual Clips**.

### Schema
```ts
export type PrimaryCategory = 'music' | 'concerts' | 'dictaphone' | 'meeting' | 'ambient' | 'unclassified';

export interface RawAudioFile {
  id: string;                          // UUID
  fingerprint: string;                 // Checksum
  originalFilename: string;            // e.g. ZOOM0001.WAV
  storagePath: string;                 // Path in ~/Music/AudioVault/raw
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  fileSizeBytes: number;
  sourceDevice: string;                // e.g. "Zoom H1n (EOS_DIGITAL)"
  importedAt: string;                  // ISO timestamp
  waveformPeaks: number[];             // Normalized downsampled peaks (for instant rendering)
}

export interface VirtualClip {
  id: string;
  parentFileId: string;                // References RawAudioFile.id
  title: string;                       // e.g. "Take 2 - Soprano Harmony"
  startTimeSeconds: number;            // Region start
  endTimeSeconds: number;              // Region end
  category: PrimaryCategory;           // Music | Concerts | Dictaphone | Meeting
  userTags: string[];                  // e.g. ["Rehearsal", "Vocal Warmup", "Section A"]
  classificationConfidence: number;   // 0.0 - 1.0
  classificationSource: 'yamnet_local' | 'whisper_local' | 'user_manual' | 'cloud_ai';
  transcription?: string;              // Optional text snippet if speech detected
  notes?: string;
  isExcluded: boolean;                 // If user marked as "Delete / Exclude"
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. Local-First Analysis & Classification Pipeline

### 4.1 Multi-Stage Pipeline
1. **Acoustic Profiling (FFmpeg / Local)**:
   - Dynamic range, RMS energy levels, zero-crossing rate (ZCR), and spectral centroid.
   - Music/Concerts feature continuous harmonic energy with high spectral bandwidth.
   - Dictaphone/Meetings feature intermittent speech bursts, higher silence ratio, and telephone-band frequencies (300Hz-3400Hz).
2. **Local Silero VAD / YAMNet**:
   - Classifies audio intervals into AudioSet events (`Music`, `Singing`, `Speech`, `Cheering/Crowd`, `Silence`).
   - If crowd/cheering + music: maps to `Concerts`.
   - If sustained singing/instruments: maps to `Music`.
3. **Local Whisper Speech Signal**:
   - Ingests audio segments into lightweight local Whisper.
   - If multi-speaker conversational dialogue is detected: maps to `Meeting`.
   - If single speaker with pauses: maps to `Dictaphone`.
   - Transcribed keywords provide high-value training signals for automated tagging.
4. **Active Learning & Human-in-the-Loop**:
   - If confidence < 0.65, flagged as `unclassified` with suggested bucket.
   - User assignment trains a local persistent k-NN / tag frequency profile for subsequent files.

---

## 5. User Interface & Interaction Flow

1. **Top Bar**:
   - Vault status indicator, search bar, active storage path display, and manual "Import Folder / File" button.
2. **Left Sidebar (Taxonomy & Buckets)**:
   - Broad categories with clip counters: `All Audio`, `Music`, `Concerts`, `Dictaphone`, `Meeting`, `Unclassified`.
   - Dynamic tag filter chip list (`#Rehearsal`, `#Warmup`, `#Standup`, etc.).
3. **Main Content (Dual-Pane)**:
   - **Top Pane**: Virtual Clip table / card grid showing thumbnails, duration, detected category pill, tags, and date.
   - **Bottom Pane (Interactive Waveform)**:
     - Full scrubbable waveform generated from pre-calculated peaks.
     - Play / Pause / Loop / Speed controls (0.75x, 1x, 1.25x, 1.5x, 2x).
     - Visual region selector: click-and-drag across waveform to highlight a segment.
     - **Context Menu (Right-Click Selection)**:
       - 🏷️ **Classify Selection As**: `Music`, `Concerts`, `Dictaphone`, `Meeting`
       - 🔖 **Add Sub-Tag**: Prompt inline tag input
       - ✂️ **Create Virtual Clip**: Saves region as a named clip without copying raw file
       - 🗑️ **Exclude / Delete Region**: Marks region so it is skipped during playback
       - 💾 **Export Selection to WAV/MP3**: Bounces region to disk if physical file needed

---

## 6. Typed IPC API Surface (`window.audioVault`)

```ts
export interface AudioVaultAPI {
  // Vault Settings
  getVaultSettings: () => Promise<VaultSettings>;
  updateVaultSettings: (settings: Partial<VaultSettings>) => Promise<VaultSettings>;
  selectVaultDirectory: () => Promise<string | null>;

  // Volume & Ingestion
  scanVolumes: () => Promise<VolumeDetectedEvent[]>;
  importFiles: (sourcePaths: string[], volumeToUnmount?: string) => Promise<IngestResult>;
  onVolumeDetected: (callback: (event: VolumeDetectedEvent) => void) => () => void;

  // Audio Library & Virtual Clips
  getLibraryFiles: () => Promise<RawAudioFile[]>;
  getVirtualClips: (filter?: ClipFilter) => Promise<VirtualClip[]>;
  createVirtualClip: (clip: Omit<VirtualClip, 'id' | 'createdAt' | 'updatedAt'>) => Promise<VirtualClip>;
  updateVirtualClip: (id: string, updates: Partial<VirtualClip>) => Promise<VirtualClip>;
  deleteVirtualClip: (id: string) => Promise<boolean>;

  // Classification & Active Learning
  reclassifyClip: (clipId: string, category: PrimaryCategory, userTag?: string) => Promise<VirtualClip>;
  getSuggestedTags: (category: PrimaryCategory) => Promise<string[]>;

  // Audio Playback & Export
  getAudioStreamUrl: (fileId: string) => string;
  exportClip: (clipId: string, targetPath: string, format?: 'wav' | 'mp3') => Promise<string>;
}
```

---

## 7. Automated Testing & Verification Plan

1. **Synthetic Programmatic Audio Fixtures**:
   - `scripts/generate-test-audio.ts`: Creates valid in-memory RIFF WAV buffers with mathematical sine waves (440Hz tone for music, pulsed square waves with silences for speech) without checking heavy multi-megabyte files into git.
2. **Unit Tests (Vitest)**:
   - Volume scanner and path resolver.
   - Deduplication hashing and signature calculation.
   - Non-destructive virtual clip slicing math (boundary overlap, exclusion handling).
   - Local classification heuristic mapping.
3. **E2E Integration Tests (Playwright for Electron)**:
   - App launch and default storage initialization.
   - Trigger simulated volume mount -> display import prompt -> execute ingest.
   - Render waveform and verify scrubbing controls.
   - Region selection and right-click context menu tagging.

---

## 8. Flagged Concerns & Architectural Trade-offs

> [!NOTE]
> **Concern 1: Local Whisper Resource Constraints on Older Hardware**  
> Whisper models require CPU/Neural Engine memory. To guarantee smooth operation out-of-the-box on any Mac, we implement a tiered strategy:
> - **Tier A**: Instant acoustic feature classification + YAMNet (sub-50ms execution).
> - **Tier B**: Background local Whisper (tiny.en quantized model) run asynchronously on a worker thread so the UI never blocks.
> - **Tier C**: Optional cloud fallback for users who explicitly enable it.

> [!NOTE]
> **Concern 2: macOS Volume Ejection Permissions**  
> Running `diskutil unmount` from Node `child_process` in an Electron app requires sandbox permissions or helper scripts if packaged for Mac App Store. For standard notarized DMG distribution, `diskutil unmount` works natively.
