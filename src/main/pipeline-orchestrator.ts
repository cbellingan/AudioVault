import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { DedupEngine } from './dedup-engine';
import { VolumeWatcher } from './volume-watcher';
import { AudioEngine } from './audio-engine';
import {
  IngestJobProgress,
  PipelineStatusEvent,
  RawAudioFile,
  VirtualClip,
} from '../shared/types';

import { TitleService } from './title-service';

export class PipelineOrchestrator extends EventEmitter {
  private dedupEngine: DedupEngine;
  private volumeWatcher: VolumeWatcher;
  private audioEngine: AudioEngine;
  private titleService: TitleService;

  // Queues
  private copyQueue: IngestJobProgress[] = [];
  private analysisQueue: IngestJobProgress[] = [];
  private activeCopyJob?: IngestJobProgress;
  private activeAnalysisJobs: Map<string, IngestJobProgress> = new Map();

  // Settings & Counters
  private isProcessingCopy = false;
  private isProcessingAnalysis = false;
  private maxAnalysisConcurrency = 3; // Parallel processing on local SSD
  private completedJobsCount = 0;
  private failedJobsCount = 0;
  private totalBatchJobsCount = 0;

  // SD Card Ejection tracking
  private pendingUnmountVolumePath?: string;
  private sdCardCopyFinished = true;
  private unmountMessage?: string;

  // Throttled notification
  private notifyTimeout: NodeJS.Timeout | null = null;

  constructor(
    dedupEngine: DedupEngine,
    volumeWatcher: VolumeWatcher,
    audioEngine: AudioEngine,
    titleService?: TitleService
  ) {
    super();
    this.dedupEngine = dedupEngine;
    this.volumeWatcher = volumeWatcher;
    this.audioEngine = audioEngine;
    this.titleService = titleService || new TitleService();
  }

  public enqueueBatch(
    filePaths: string[],
    volumeToUnmount?: string
  ): { batchId: string; count: number } {
    const batchId = `batch_${Date.now()}`;
    this.pendingUnmountVolumePath = volumeToUnmount;
    this.sdCardCopyFinished = false;
    this.unmountMessage = undefined;

    // Resolve directories to individual audio files
    const resolvedPaths: string[] = [];
    for (const p of filePaths) {
      if (!fs.existsSync(p)) continue;
      try {
        const stats = fs.statSync(p);
        if (stats.isDirectory()) {
          const found = this.volumeWatcher.scanDirectoryForAudio(p);
          for (const f of found) {
            resolvedPaths.push(f.path);
          }
        } else if (stats.isFile()) {
          resolvedPaths.push(p);
        }
      } catch (e) {}
    }

    let addedCount = 0;
    for (const filePath of resolvedPaths) {
      if (!fs.existsSync(filePath)) continue;

      const stats = fs.statSync(filePath);
      const job: IngestJobProgress = {
        jobId: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sourcePath: filePath,
        filename: path.basename(filePath),
        stage: 'queued_copy',
        bytesCopied: 0,
        totalBytes: stats.size,
        copyPercent: 0,
        analysisPercent: 0,
        currentTaskDescription: 'Waiting in sequential SD card queue...',
      };

      this.copyQueue.push(job);
      this.totalBatchJobsCount++;
      addedCount++;
    }

    this.throttleBroadcastStatus();
    this.processNextCopy();
    return { batchId, count: addedCount };
  }

  /**
   * Scans local vault raw directory for any existing files that have not yet completed analysis,
   * queuing them directly for background SSD analysis.
   */
  public enqueueUnprocessedRawFiles(): number {
    const rawDir = this.dedupEngine.getRawDir();
    if (!fs.existsSync(rawDir)) return 0;

    const registeredPaths = new Set(this.dedupEngine.getAllRawFiles().map((r) => r.storagePath));
    const entries = fs.readdirSync(rawDir);
    let count = 0;

    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const fullPath = path.join(rawDir, name);
      if (!registeredPaths.has(fullPath) && fs.existsSync(fullPath)) {
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile() && stats.size > 44) {
            const fingerprint = this.dedupEngine.computeFileFingerprint(fullPath);
            if (this.dedupEngine.isFingerprintImported(fingerprint)) continue;

            const job: IngestJobProgress = {
              jobId: `reconcile_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              sourcePath: fullPath,
              filename: name.replace(/^\d+_/, ''),
              stage: 'queued_analysis',
              bytesCopied: stats.size,
              totalBytes: stats.size,
              copyPercent: 100,
              analysisPercent: 0,
              currentTaskDescription: 'Analyzing unprocessed take from vault...',
            };
            (job as any).targetPath = fullPath;
            (job as any).fingerprint = fingerprint;

            this.analysisQueue.push(job);
            this.totalBatchJobsCount++;
            count++;
          }
        } catch (err) {}
      }
    }

    if (count > 0) {
      this.throttleBroadcastStatus();
      this.processNextAnalysis();
    }
    return count;
  }

  /**
   * Enqueues a single local audio file already stored in the vault raw directory for SSD analysis.
   */
  public enqueueLocalFile(
    filePath: string,
    customTitle?: string,
    sourceDevice = 'In-App Recorder',
    existingClipId?: string,
    existingRawFileId?: string
  ): IngestJobProgress | null {
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    const fingerprint = this.dedupEngine.computeFileFingerprint(filePath);
    const job: IngestJobProgress = {
      jobId: `take_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sourcePath: filePath,
      filename: path.basename(filePath),
      stage: 'queued_analysis',
      bytesCopied: stats.size,
      totalBytes: stats.size,
      copyPercent: 100,
      analysisPercent: 0,
      currentTaskDescription: 'Processing recorded take with local Whisper & acoustic engine...',
    };
    (job as any).targetPath = filePath;
    (job as any).fingerprint = fingerprint;
    (job as any).customTitle = customTitle;
    (job as any).sourceDevice = sourceDevice;
    (job as any).existingClipId = existingClipId;
    (job as any).existingRawFileId = existingRawFileId;

    this.analysisQueue.push(job);
    this.totalBatchJobsCount++;
    this.throttleBroadcastStatus();
    this.processNextAnalysis();
    return job;
  }

  public getStatus(): PipelineStatusEvent {
    return {
      totalJobs: this.totalBatchJobsCount,
      completedJobs: this.completedJobsCount,
      failedJobs: this.failedJobsCount,
      activeCopyJob: this.activeCopyJob,
      activeAnalysisJobs: Array.from(this.activeAnalysisJobs.values()),
      isSdCardActive: !this.sdCardCopyFinished,
      canUnmountSdCard: this.sdCardCopyFinished && !!this.pendingUnmountVolumePath,
      unmountMessage: this.unmountMessage,
    };
  }

  /**
   * Stage 1: STRICTLY SERIAL SD Card Ingestion (Concurrency = 1).
   * Streams file chunk-by-chunk to prevent bus saturation.
   */
  private async processNextCopy() {
    if (this.isProcessingCopy) return;
    if (this.copyQueue.length === 0) {
      // All copy operations completed! SD Card can now be safely unmounted immediately!
      if (!this.sdCardCopyFinished) {
        this.sdCardCopyFinished = true;
        await this.handleCleanUnmountIfRequested();
      }
      this.activeCopyJob = undefined;
      this.throttleBroadcastStatus();
      return;
    }

    this.isProcessingCopy = true;
    const currentJob = this.copyQueue.shift()!;
    this.activeCopyJob = currentJob;
    currentJob.stage = 'copying';
    currentJob.currentTaskDescription = 'Streaming from external media (Serial I/O)...';
    this.throttleBroadcastStatus();

    const rawDir = this.dedupEngine.getRawDir();
    const targetFilename = `${Date.now()}_${currentJob.filename}`;
    const targetPath = path.join(rawDir, targetFilename);

    try {
      // Check deduplication
      const fingerprint = this.dedupEngine.computeFileFingerprint(currentJob.sourcePath);
      if (this.dedupEngine.isFingerprintImported(fingerprint)) {
        currentJob.stage = 'completed';
        currentJob.currentTaskDescription = 'Already imported (deduplicated).';
        this.completedJobsCount++;
      } else {
        // Stream copy with progress updates
        await this.streamCopyFile(currentJob.sourcePath, targetPath, (copied, total) => {
          currentJob.bytesCopied = copied;
          currentJob.copyPercent = total > 0 ? Math.round((copied / total) * 100) : 100;
          this.throttleBroadcastStatus();
        });

        // File is now safely on fast internal SSD! Push to parallel analysis queue
        currentJob.stage = 'queued_analysis';
        currentJob.currentTaskDescription = 'File on SSD. Queued for local acoustic analysis...';
        (currentJob as any).targetPath = targetPath;
        (currentJob as any).fingerprint = fingerprint;
        this.analysisQueue.push(currentJob);
        this.processNextAnalysis();
      }
    } catch (err: any) {
      currentJob.stage = 'failed';
      currentJob.error = err.message || String(err);
      this.failedJobsCount++;
    } finally {
      this.isProcessingCopy = false;
      this.throttleBroadcastStatus();
      this.processNextCopy(); // Sequential next
    }
  }

  /**
   * Stage 2: PARALLEL Local Analysis Worker Pool (Concurrency = 3).
   * Runs compute-heavy tasks on local fast SSD.
   */
  private async processNextAnalysis() {
    if (this.activeAnalysisJobs.size >= this.maxAnalysisConcurrency) return;
    if (this.analysisQueue.length === 0) return;

    const currentJob = this.analysisQueue.shift()!;
    this.activeAnalysisJobs.set(currentJob.jobId, currentJob);
    currentJob.stage = 'analyzing';
    currentJob.currentTaskDescription = 'Extracting peaks & computing acoustic profile...';
    this.throttleBroadcastStatus();

    // Trigger next worker concurrently if slots remain
    if (this.activeAnalysisJobs.size < this.maxAnalysisConcurrency && this.analysisQueue.length > 0) {
      this.processNextAnalysis();
    }

    try {
      const targetPath = (currentJob as any).targetPath;
      const fingerprint = (currentJob as any).fingerprint;
      const stats = fs.statSync(targetPath);
      console.log(`[AudioVault Pipeline] 🚀 Starting analysis of: ${currentJob.filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

      // 1. Acoustic & Waveform Analysis
      const analysis = this.audioEngine.analyzeWavFile(targetPath);
      console.log(`[AudioVault Pipeline] 📊 Analyzed WAV: ${analysis.features.sampleRate}Hz, ${analysis.features.channels}ch, ${analysis.features.durationSeconds}s, peaks: ${analysis.peaks.length}`);
      currentJob.analysisPercent = 50;
      currentJob.currentTaskDescription = 'Running local Whisper speech transcription...';
      this.throttleBroadcastStatus();

      // 2. Local Whisper Transcription
      const transcriptRes = await this.audioEngine.transcribeAudioDetails(targetPath);
      const transcript = transcriptRes?.text || null;
      const transcriptChunks = transcriptRes?.chunks;
      if (transcript) {
        console.log(`[AudioVault Pipeline] 🗣️ Whisper transcript for ${currentJob.filename}: "${transcript.slice(0, 60)}..."`);
      }
      currentJob.analysisPercent = 85;
      currentJob.currentTaskDescription = 'Classifying audio events & generating metadata...';
      this.throttleBroadcastStatus();

      // 3. Local AI Classification
      const classification = this.audioEngine.classifyAcoustics(
        analysis.features,
        currentJob.filename,
        transcript
      );
      console.log(`[AudioVault Pipeline] 🏷️ Classified as: ${classification.category.toUpperCase()} (${(classification.confidence * 100).toFixed(0)}%)`);
      currentJob.analysisPercent = 95;
      this.throttleBroadcastStatus();

      // 3. Register Raw File in Vault (or retrieve existing)
      let rawFileId = (currentJob as any).existingRawFileId;
      if (!rawFileId) {
        const existingRaw = this.dedupEngine.getRawFileByFingerprint(fingerprint);
        if (existingRaw) {
          rawFileId = existingRaw.id;
          if (
            (!existingRaw.waveformPeaks || existingRaw.waveformPeaks.length === 0) &&
            analysis.peaks &&
            analysis.peaks.length > 0
          ) {
            existingRaw.waveformPeaks = analysis.peaks;
            this.dedupEngine.addRawFile(existingRaw);
          }
        } else {
          rawFileId = `raw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const assignedSource =
            (currentJob as any).sourceDevice ||
            (this.pendingUnmountVolumePath ? path.basename(this.pendingUnmountVolumePath) : 'Manual Ingest');
          const rawAudioRecord: RawAudioFile = {
            id: rawFileId,
            fingerprint,
            originalFilename: currentJob.filename,
            storagePath: targetPath,
            durationSeconds: analysis.features.durationSeconds,
            sampleRate: analysis.features.sampleRate,
            channels: analysis.features.channels,
            fileSizeBytes: stats.size,
            sourceDevice: assignedSource,
            importedAt: new Date().toISOString(),
            waveformPeaks: analysis.peaks,
          };
          this.dedupEngine.addRawFile(rawAudioRecord);
        }
      } else {
        const existingRaw = this.dedupEngine.getRawFile(rawFileId);
        if (
          existingRaw &&
          (!existingRaw.waveformPeaks || existingRaw.waveformPeaks.length === 0) &&
          analysis.peaks &&
          analysis.peaks.length > 0
        ) {
          existingRaw.waveformPeaks = analysis.peaks;
          this.dedupEngine.addRawFile(existingRaw);
        }
      }

      // 4. Create or Update Non-Destructive Virtual Clip (with local LLM composite title if speech transcribed)
      let initialTitle = (currentJob as any).customTitle || currentJob.filename.replace(/\.[^/.]+$/, '');
      const speechToSummarize = transcript || classification.transcriptionSnippet;
      if (speechToSummarize && speechToSummarize.length > 5 && !(currentJob as any).customTitle) {
        try {
          initialTitle = await this.titleService.generateCompositeTitle(initialTitle, speechToSummarize);
        } catch (titleErr) {
          console.warn('[AudioVault Pipeline] Title generation fallback:', titleErr);
        }
      }

      const existingClipId = (currentJob as any).existingClipId;
      let defaultClip: VirtualClip;

      if (existingClipId && this.dedupEngine.getVirtualClip(existingClipId)) {
        const existing = this.dedupEngine.getVirtualClip(existingClipId)!;
        const mergedTags = Array.from(new Set([...existing.userTags, ...classification.tags]));
        const updated = this.dedupEngine.updateVirtualClip(existingClipId, {
          title: (currentJob as any).customTitle ? existing.title : initialTitle,
          category: classification.category,
          userTags: mergedTags,
          classificationConfidence: classification.confidence,
          classificationSource: 'yamnet_local',
          transcription: classification.transcriptionSnippet,
          transcriptionChunks: transcriptChunks,
          updatedAt: new Date().toISOString(),
        });
        defaultClip = updated || existing;
      } else {
        const existingClips = this.dedupEngine.getClipsForRawFile(rawFileId);
        if (existingClips.length > 0) {
          const firstClip = existingClips[0];
          const mergedTags = Array.from(new Set([...firstClip.userTags, ...classification.tags]));
          const updated = this.dedupEngine.updateVirtualClip(firstClip.id, {
            title: firstClip.title || initialTitle,
            category: classification.category,
            userTags: mergedTags,
            classificationConfidence: classification.confidence,
            classificationSource: 'yamnet_local',
            transcription: classification.transcriptionSnippet,
            transcriptionChunks: transcriptChunks,
            updatedAt: new Date().toISOString(),
          });
          defaultClip = updated || firstClip;
        } else {
          const clipId = `clip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          defaultClip = {
            id: clipId,
            parentFileId: rawFileId,
            title: initialTitle,
            startTimeSeconds: 0,
            endTimeSeconds: analysis.features.durationSeconds,
            category: classification.category,
            userTags: classification.tags,
            classificationConfidence: classification.confidence,
            classificationSource: 'yamnet_local',
            transcription: classification.transcriptionSnippet,
            transcriptionChunks: transcriptChunks,
            isExcluded: false,
            createdAt: analysis.creationTimestamp || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          this.dedupEngine.addVirtualClip(defaultClip);
          const candidate = this.dedupEngine.getClipsForRawFile(rawFileId)[0];
          if (candidate) {
            defaultClip = candidate;
          }
        }
      }

      currentJob.stage = 'completed';
      currentJob.analysisPercent = 100;
      currentJob.currentTaskDescription = `Completed. Categorized as ${classification.category.toUpperCase()}`;
      this.completedJobsCount++;
      console.log(`[AudioVault Pipeline] ✅ Registered into Vault: ${currentJob.filename}`);
      this.emit('job-completed', currentJob, defaultClip);
    } catch (err: any) {
      console.error(`[AudioVault Pipeline] ❌ Analysis FAILED for ${currentJob.filename}:`, err);
      currentJob.stage = 'failed';
      currentJob.error = err.message || String(err);
      this.failedJobsCount++;
    } finally {
      this.activeAnalysisJobs.delete(currentJob.jobId);
      this.throttleBroadcastStatus();
      this.processNextAnalysis();
    }
  }

  private async handleCleanUnmountIfRequested() {
    if (!this.pendingUnmountVolumePath) return;
    const settings = this.dedupEngine.getSettings();
    if (settings.autoUnmountAfterIngest) {
      const res = await this.volumeWatcher.unmountVolume(this.pendingUnmountVolumePath);
      this.unmountMessage = res.success
        ? `Cleanly unmounted ${path.basename(this.pendingUnmountVolumePath)}. Safe to remove card!`
        : `Unmount notice: ${res.message}`;
    }
  }

  private streamCopyFile(
    src: string,
    dest: string,
    onProgress: (copied: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stats = fs.statSync(src);
      const readStream = fs.createReadStream(src, { highWaterMark: 65536 });
      const writeStream = fs.createWriteStream(dest);
      let copiedBytes = 0;

      readStream.on('data', (chunk) => {
        copiedBytes += chunk.length;
        onProgress(copiedBytes, stats.size);
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', () => resolve());

      readStream.pipe(writeStream);
    });
  }

  private throttleBroadcastStatus() {
    if (this.notifyTimeout) return;
    this.notifyTimeout = setTimeout(() => {
      this.notifyTimeout = null;
      this.emit('pipeline-status', this.getStatus());
    }, 80); // Throttled to ~12 updates per second max
  }
}
