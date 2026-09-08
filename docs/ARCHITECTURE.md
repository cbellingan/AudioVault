# System Architecture: AudioVault Non-Blocking Ingestion & Analysis Engine

**Status**: Architectural Design Specification  
**Governing Intent**: [`intent/intent.md`](file:///Users/cb/Documents/antigravity/blissful-hopper/intent/intent.md)  
**Related Specs**: [`docs/spec.md`](file:///Users/cb/Documents/antigravity/blissful-hopper/docs/spec.md)

---

## 1. Executive Summary & Design Constraints

AudioVault is architected to solve two competing physical hardware constraints:
1. **Fragile & Bandwidth-Limited SD Card I/O**:
   External SD cards and handheld recorders (Zoom, Tascam) running on FAT32/exFAT over USB 2.0/3.0 or SD bus readers choke when subjected to concurrent reads. Multiple threads competing for random reads degrade throughput from 40 MB/s to sub-1 MB/s and can trigger card write-lock errors.
   **Rule: SD Card Ingest must be strictly SERIAL (Concurrency = 1).**

2. **Compute-Heavy Audio Processing**:
   Acoustic profiling, RMS calculation, waveform peak generation, and local Whisper speech transcription are CPU/GPU-bound tasks that take seconds or minutes for long takes.
   **Rule: Processing must never block the UI thread or serialize with SD card reading.**

---

## 2. High-Level System Topology

```
+-------------------------------------------------------------------------------------------------+
|                                     RENDERER PROCESS (UI)                                       |
|  - 60/120 FPS React Interface: responsive scrubbing, tagging, waveform visualization           |
|  - Subscribes to Ingest Jobs via Event Streams (`onJobProgress`, `onJobCompleted`)              |
|  - Zero heavy computation; zero direct filesystem or native thread access                       |
+-------------------------------------------------------------------------------------------------+
                                               ▲ │
                        (Event Subscriptions)  │ │ (Async IPC Actions: startIngest, pause, cancel)
                                               │ ▼
+-------------------------------------------------------------------------------------------------+
|                                 PRELOAD CONTEXT BRIDGE (Typed IPC)                              |
|  - `window.audioVault`: Strictly sanitized IPC invoke & event listener dispatch                 |
+-------------------------------------------------------------------------------------------------+
                                               ▲ │
                                               │ ▼
+-------------------------------------------------------------------------------------------------+
|                                     ELECTRON MAIN PROCESS                                       |
|                                                                                                 |
|   +-----------------------------------------------------------------------------------------+   |
|   |                       INGEST & PROCESSING PIPELINE ORCHESTRATOR                         |   |
|   +-----------------------------------------------------------------------------------------+   |
|         │                                                                 ▲                     |
|         ▼ [Stage 1: Serial I/O Queue]                                     │ (Job State Events)  |
|   +---------------------------------------+                               │                     |
|   |         SERIAL SD CARD READER         |                               │                     |
|   | - Single worker (Concurrency = 1)     |                               │                     |
|   | - Sequential streaming copy           |                               │                     |
|   | - Verifies bit-for-bit checksum       |                               │                     |
|   | - Streams file from SD Card -> SSD    |                               │                     |
|   +---------------------------------------+                               │                     |
|         │                                                                 │                     |
|         ▼ [File Lands on Local Fast SSD]                                  │                     |
|   +-------------------------------------------------------------------+   │                     |
|   |                PARALLEL LOCAL ANALYSIS WORKER POOL                |   │                     |
|   | - Multi-threaded Worker Pool (Concurrency = CPU cores - 1)        |───┤                     |
|   | - Task A: Waveform Peak Generation (FFmpeg/WAV reader)            |   │                     |
|   | - Task B: Acoustic Metrics (RMS, silence ratio, dynamic range)    |   │                     |
|   | - Task C: Local YAMNet Event Detection (Music / Singing / Speech) |   │                     |
|   | - Task D: Local Whisper Transcription (quantized model)           |   │                     |
|   +-------------------------------------------------------------------+   │                     |
|         │                                                                 │                     |
|         ▼ [Classification & Virtual Clip Created]                         │                     |
|   +-------------------------------------------------------------------+   │                     |
|   |                     METADATA VAULT (SQLite / JSON)                |───┘                     |
|   | - Stores RawAudioFile descriptor & VirtualClip records            |                         |
|   | - Deduplication Index                                             |                         |
|   +-------------------------------------------------------------------+                         |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+
```

---

## 3. Asynchronous Pipeline Stages & Job Lifecycle

Every imported audio file passes through a multi-stage state machine:

```
[ PENDING ]
     │
     ▼ (Picked up by Serial SD Reader)
[ COPYING_SERIAL ] ─── (Progress: 0% -> 100% bytes transferred)
     │
     ▼ (File written to local SSD; SD Reader moves to next file)
[ QUEUED_FOR_ANALYSIS ]
     │
     ▼ (Parallel Worker Available)
[ ANALYZING_PARALLEL ] ─── (Acoustics + Waveform Peaks + Whisper)
     │
     ▼
[ CLASSIFIED ] ─── (Assigned to Music / Concerts / Dictaphone / Meeting)
     │
     ▼
[ COMPLETED ]
```

### Stage 1: The Serial SD Card Ingest Queue (`concurrency: 1`)
- **Queue Implementation**: A FIFO queue dedicated strictly to external volume reads.
- **Buffer Streaming**: Uses a 64KB chunk stream with `fs.createReadStream` -> `fs.createWriteStream` to keep memory footprint constant regardless of file size (e.g. 2GB 24-bit/96kHz WAV files).
- **Early Hashing**: Computes SHA-256 fingerprint on-the-fly during the read stream so no second pass is needed.
- **Hardware Protection**: Once the last item in the queue completes, signals the `VolumeUnmounter` if the user opted for clean ejection.

### Stage 2: The Parallel Local Processing Worker Pool (`concurrency: Math.max(1, cores - 1)`)
- Once a file safely resides on the internal fast SSD (`~/Music/AudioVault/raw/`), it is pushed to the `AnalysisQueue`.
- The analysis queue runs with a configurable concurrency limit (default: 2–4 workers).
- Processing runs in background threads using Node `worker_threads` or asynchronous chunked promises so the Node event loop is never blocked for more than 5ms.

---

## 4. UI / Main Process IPC Contract

### 4.1 Job State Definitions
```ts
export type IngestJobStage = 
  | 'queued_copy' 
  | 'copying' 
  | 'queued_analysis' 
  | 'analyzing' 
  | 'completed' 
  | 'failed';

export interface IngestJobProgress {
  jobId: string;
  sourcePath: string;
  filename: string;
  stage: IngestJobStage;
  bytesCopied: number;
  totalBytes: number;
  copyPercent: number;        // 0 - 100
  analysisPercent: number;    // 0 - 100
  currentTaskDescription: string;
  error?: string;
}

export interface PipelineStatusEvent {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeCopyJob?: IngestJobProgress;
  activeAnalysisJobs: IngestJobProgress[];
  isSdCardActive: boolean;
  canUnmountSdCard: boolean;
}
```

### 4.2 Non-Blocking IPC Methods
```ts
export interface AudioVaultPipelineAPI {
  // Enqueue batch import (returns immediately with batch ID)
  enqueueIngestBatch: (filePaths: string[], volumeToUnmount?: string) => Promise<{ batchId: string; jobCount: number }>;
  
  // Pause / Resume / Cancel
  pauseIngest: () => Promise<void>;
  resumeIngest: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<boolean>;

  // Real-time Event Stream Listeners
  onPipelineProgress: (callback: (status: PipelineStatusEvent) => void) => () => void;
  onJobComplete: (callback: (job: IngestJobProgress, clip: VirtualClip) => void) => () => void;
}
```

---

## 5. Memory Management & UI Performance Guarantees

1. **Zero UI Thread Blocking**:
   - The React renderer thread only receives throttled status updates (max 10 updates per second / 100ms throttle) via IPC.
   - Large audio buffers are **never** serialized over IPC. Only downsampled peak arrays (e.g. 100–300 numbers) are passed to the renderer.
2. **Audio Playback Streaming**:
   - Audio files are streamed via custom Electron protocol `audiovault://file/<fileId>` using HTTP range requests (`net.fetch`). Large 1GB takes stream on-demand into HTML5 `<audio>` tags without buffering the entire file in RAM.
3. **Graceful Degrade on Low-End Hardware**:
   - If CPU load exceeds 85%, the pipeline automatically throttles local Whisper to run sequentially after peaks are generated.

---

## 6. Architecture Verification Plan

1. **Unit Verification**:
   - Test serial queue strictly executes 1 read at a time by asserting overlapping read operations never exceed 1.
   - Test parallel worker pool processes multiple local files concurrently.
2. **Integration Verification**:
   - Playwright test: Enqueue 5 synthetic audio takes simultaneously.
   - Verify UI renders a responsive progress bar showing sequential copy stage (`1 of 5 copying...`) followed by concurrent analysis badges (`analyzing acoustics...`).
   - Verify UI buttons and waveform scrubber remain interactive during heavy simulated copy operations.
