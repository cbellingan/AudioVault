import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  RawAudioFile,
  VirtualClip,
  VaultSettings,
  DeletedFileRecord,
  CollectionRecord,
  ImportBatchRecord,
  SavedViewRecord,
  VaultStats,
} from '../shared/types';

export class DedupEngine {
  private vaultDir: string;
  private registryFile: string;
  private rawFiles: Map<string, RawAudioFile> = new Map();
  private virtualClips: Map<string, VirtualClip> = new Map();
  private deletedFiles: Map<string, DeletedFileRecord> = new Map();
  private collections: Map<string, CollectionRecord> = new Map();
  private importBatches: Map<string, ImportBatchRecord> = new Map();
  private savedViews: Map<string, SavedViewRecord> = new Map();
  private schemaVersion: number = 3;
  private settings: VaultSettings;

  constructor(customVaultDir?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const prodVault = path.join(homeDir, 'Music', 'AudioVault');
    const isTestMode =
      process.env.AUDIOVAULT_TEST_MODE === '1' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true';

    const targetDir = customVaultDir || process.env.AUDIOVAULT_VAULT_DIR;
    if (isTestMode) {
      if (!targetDir || path.resolve(targetDir) === path.resolve(prodVault)) {
        throw new Error(
          `[AudioVault Hard Guard] Test mode active (AUDIOVAULT_TEST_MODE, NODE_ENV=test, or VITEST), but no isolated vault directory was specified or the production vault path was targeted: "${targetDir || 'undefined'}". Accessing production vault during tests is strictly forbidden.`
        );
      }
    }

    this.vaultDir = targetDir || prodVault;
    this.registryFile = path.join(this.vaultDir, 'registry.json');
    this.settings = {
      vaultDirectory: this.vaultDir,
      autoUnmountAfterIngest: true,
      useLocalModelsDefault: true,
      enableCloudFallback: false,
      whisperLanguage: 'en',
      rememberDeleteChoice: false,
    };
    this.ensureDirectories();
    this.loadRegistry();
  }

  public getSettings(): VaultSettings {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<VaultSettings>): VaultSettings {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.vaultDirectory && newSettings.vaultDirectory !== this.vaultDir) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
      const prodVault = path.join(homeDir, 'Music', 'AudioVault');
      const isTestMode =
        process.env.AUDIOVAULT_TEST_MODE === '1' ||
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST === 'true';

      if (isTestMode && path.resolve(newSettings.vaultDirectory) === path.resolve(prodVault)) {
        throw new Error(
          `[AudioVault Hard Guard] Attempted to switch vault directory to production vault during test mode: "${newSettings.vaultDirectory}". Strictly forbidden.`
        );
      }
      this.vaultDir = newSettings.vaultDirectory;
      this.registryFile = path.join(this.vaultDir, 'registry.json');
      this.ensureDirectories();
      this.loadRegistry();
    }
    this.saveRegistry();
    return { ...this.settings };
  }

  public getVaultDir(): string {
    return this.vaultDir;
  }

  public getRawDir(): string {
    return path.join(this.vaultDir, 'raw');
  }

  public getExportsDir(): string {
    return path.join(this.vaultDir, 'exports');
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true });
    }
    const rawDir = this.getRawDir();
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }
    const exportsDir = this.getExportsDir();
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
  }

  private loadRegistry() {
    try {
      if (!fs.existsSync(this.registryFile)) {
        return;
      }

      let raw: string;
      try {
        raw = fs.readFileSync(this.registryFile, 'utf-8');
      } catch (readErr) {
        console.error('[AudioVault Dedup] Failed reading registry file:', readErr);
        return;
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        console.error('[AudioVault Dedup] ⚠️ Corrupt JSON in registry file!', parseErr);
        const backupFile = `${this.registryFile}.bak`;
        if (fs.existsSync(backupFile)) {
          try {
            const bakRaw = fs.readFileSync(backupFile, 'utf-8');
            data = JSON.parse(bakRaw);
            console.log('[AudioVault Dedup] 🔄 Successfully recovered registry from backup:', backupFile);
          } catch {
            const corruptPath = `${this.registryFile}.corrupt.${Date.now()}`;
            fs.copyFileSync(this.registryFile, corruptPath);
            console.error('[AudioVault Dedup] Preserved corrupt registry at:', corruptPath);
            return;
          }
        } else {
          const corruptPath = `${this.registryFile}.corrupt.${Date.now()}`;
          fs.copyFileSync(this.registryFile, corruptPath);
          console.error('[AudioVault Dedup] Preserved corrupt registry at:', corruptPath);
          return;
        }
      }

      const currentVer = data.version || 1;
      let registryNeedsSave = false;

      // Pre-migration backup if upgrading from legacy schema (< 3)
      if (currentVer < 3) {
        try {
          fs.writeFileSync(`${this.registryFile}.v2.bak`, raw, 'utf-8');
          fs.writeFileSync(`${this.registryFile}.bak`, raw, 'utf-8');
          console.log(`[AudioVault Dedup] 📦 Created migration backup: ${this.registryFile}.v2.bak`);
        } catch (bakErr) {
          console.warn('[AudioVault Dedup] Warning: Failed writing pre-migration backup', bakErr);
        }
        registryNeedsSave = true;
      }

      // Map duplicate rawFileIds to their primary canonical rawFileId
      const rawIdRemap = new Map<string, string>();
      const fingerprintMap = new Map<string, RawAudioFile>();
      const pathMap = new Map<string, RawAudioFile>();

      if (data.rawFiles) {
        for (const item of data.rawFiles) {
          const match =
            (item.fingerprint && fingerprintMap.get(item.fingerprint)) ||
            (item.storagePath && pathMap.get(item.storagePath));
          if (match) {
            rawIdRemap.set(item.id, match.id);
            registryNeedsSave = true;
            if (
              (!match.waveformPeaks || match.waveformPeaks.length === 0) &&
              item.waveformPeaks &&
              item.waveformPeaks.length > 0
            ) {
              match.waveformPeaks = item.waveformPeaks;
            }
            if (match.durationSeconds === 0 && item.durationSeconds > 0) {
              match.durationSeconds = item.durationSeconds;
            }
          } else {
            this.rawFiles.set(item.id, item);
            if (item.fingerprint) fingerprintMap.set(item.fingerprint, item);
            if (item.storagePath) pathMap.set(item.storagePath, item);
          }
        }
      }

      if (data.virtualClips) {
        for (const item of data.virtualClips) {
          if (rawIdRemap.has(item.parentFileId)) {
            item.parentFileId = rawIdRemap.get(item.parentFileId)!;
            registryNeedsSave = true;
          }

          // Schema V3 field normalization (do not fabricate unknown dates!)
          item.reviewed = item.reviewed ?? false;
          item.favorite = item.favorite ?? false;
          item.collections = Array.isArray(item.collections) ? item.collections : [];

          const existing = Array.from(this.virtualClips.values()).find(
            (c) =>
              c.parentFileId === item.parentFileId &&
              Math.abs(c.startTimeSeconds - item.startTimeSeconds) < 0.05 &&
              Math.abs(c.endTimeSeconds - item.endTimeSeconds) < 0.05
          );

          if (existing) {
            registryNeedsSave = true;
            if (item.transcription && !existing.transcription) {
              existing.transcription = item.transcription;
            }
            if (
              item.transcriptionChunks &&
              item.transcriptionChunks.length > 0 &&
              (!existing.transcriptionChunks || existing.transcriptionChunks.length === 0)
            ) {
              existing.transcriptionChunks = item.transcriptionChunks;
            }
            if (
              item.title &&
              !item.title.startsWith('In-App Take') &&
              existing.title.startsWith('In-App Take')
            ) {
              existing.title = item.title;
            }
            if (item.userTags && item.userTags.length > 0) {
              existing.userTags = Array.from(new Set([...existing.userTags, ...item.userTags]));
            }
            if (item.collections && item.collections.length > 0) {
              existing.collections = Array.from(new Set([...(existing.collections || []), ...item.collections]));
            }
            if (item.notes && !existing.notes) {
              existing.notes = item.notes;
            }
            if (item.exportedMp3Path && !existing.exportedMp3Path) {
              existing.exportedMp3Path = item.exportedMp3Path;
              existing.exportedAt = item.exportedAt;
            }
            if (
              item.classificationConfidence &&
              item.classificationConfidence > existing.classificationConfidence
            ) {
              existing.classificationConfidence = item.classificationConfidence;
            }
            if (item.reviewed !== undefined) existing.reviewed = item.reviewed;
            if (item.favorite !== undefined) existing.favorite = item.favorite;
            if (item.recordedAt && !existing.recordedAt) existing.recordedAt = item.recordedAt;
            if (item.userTitle && !existing.userTitle) existing.userTitle = item.userTitle;
            if (item.editedTranscript && !existing.editedTranscript) existing.editedTranscript = item.editedTranscript;
          } else {
            this.virtualClips.set(item.id, item);
          }
        }
      }

      if (data.deletedFiles && Array.isArray(data.deletedFiles)) {
        for (const item of data.deletedFiles) {
          if (item && item.fingerprint) {
            this.deletedFiles.set(item.fingerprint, item);
          }
        }
      }

      if (data.collections && Array.isArray(data.collections)) {
        for (const col of data.collections) {
          if (col && col.id) {
            this.collections.set(col.id, col);
          }
        }
      }

      if (data.importBatches && Array.isArray(data.importBatches)) {
        for (const b of data.importBatches) {
          if (b && b.id) {
            this.importBatches.set(b.id, b);
          }
        }
      }

      if (data.savedViews && Array.isArray(data.savedViews)) {
        for (const v of data.savedViews) {
          if (v && v.id) {
            this.savedViews.set(v.id, v);
          }
        }
      }

      if (data.settings) {
        this.settings = { ...this.settings, ...data.settings };
      }

      // Check if registry on disk contained legacy embedded transcript bloat
      const hadLegacyEmbeddedTranscripts =
        Array.isArray(data.virtualClips) &&
        data.virtualClips.some(
          (c: any) =>
            c.transcription ||
            c.fullTranscription ||
            (c.transcriptionChunks && c.transcriptionChunks.length > 0)
        );
      if (hadLegacyEmbeddedTranscripts) {
        registryNeedsSave = true;
      }

      // Sidecar Migration & Backfill: ensure every clip with a transcript has a sidecar .txt file
      for (const clip of this.virtualClips.values()) {
        const rawFile = this.rawFiles.get(clip.parentFileId);
        if (rawFile && rawFile.storagePath) {
          const ext = path.extname(rawFile.storagePath);
          const txtPath = rawFile.storagePath.slice(0, -ext.length) + '.txt';
          const chunksPath = rawFile.storagePath.slice(0, -ext.length) + '.chunks.json';

          if (fs.existsSync(txtPath)) {
            clip.transcriptPath = txtPath;
            if (!clip.fullTranscription) {
              try {
                clip.fullTranscription = fs.readFileSync(txtPath, 'utf-8');
                const clean = clip.fullTranscription
                  .replace(/^\[(?:Local )?Whisper\]:\s*"?/i, '')
                  .replace(/"?$/, '')
                  .trim();
                const snippet = clean.length > 220 ? `${clean.slice(0, 220).trim()}...` : clean;
                clip.transcription = `[Whisper]: "${snippet}"`;
              } catch {}
            }
          } else if (clip.fullTranscription || clip.transcription) {
            const textToWrite =
              clip.fullTranscription ||
              (clip.transcription
                ? clip.transcription
                    .replace(/^\[(?:Local )?Whisper\]:\s*"?/i, '')
                    .replace(/"?$/, '')
                    .trim()
                : '');
            if (textToWrite && textToWrite.length > 3 && !textToWrite.startsWith('...')) {
              try {
                fs.writeFileSync(txtPath, textToWrite, 'utf-8');
                clip.transcriptPath = txtPath;
                registryNeedsSave = true;
                console.log(`[AudioVault Dedup] 📝 Backfilled transcript file to: ${txtPath}`);
              } catch (err) {
                console.warn(`[AudioVault Dedup] Failed writing backfilled transcript: ${txtPath}`, err);
              }
            }
          }

          if (fs.existsSync(chunksPath) && (!clip.transcriptionChunks || clip.transcriptionChunks.length === 0)) {
            try {
              clip.transcriptionChunks = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
            } catch {}
          } else if (clip.transcriptionChunks && clip.transcriptionChunks.length > 0 && !fs.existsSync(chunksPath)) {
            try {
              fs.writeFileSync(chunksPath, JSON.stringify(clip.transcriptionChunks, null, 2), 'utf-8');
              registryNeedsSave = true;
            } catch {}
          }

          // Backfill and synchronize .edited.txt sidecar for user transcript edits (Slice F10)
          const editedTxtPath = rawFile.storagePath.slice(0, -ext.length) + '.edited.txt';
          if (fs.existsSync(editedTxtPath) && !clip.editedTranscript) {
            try {
              clip.editedTranscript = fs.readFileSync(editedTxtPath, 'utf-8');
            } catch {}
          } else if (clip.editedTranscript && !fs.existsSync(editedTxtPath)) {
            try {
              fs.writeFileSync(editedTxtPath, clip.editedTranscript, 'utf-8');
            } catch {}
          }
        }
      }

      if (registryNeedsSave) {
        console.log('[AudioVault Dedup] 🧹 Auto-cleaned and migrated registry to sidecar files & V3 schema.');
        this.saveRegistry();
      }
    } catch (err) {
      console.error('Failed to load AudioVault registry:', err);
    }
  }

  public saveRegistry() {
    try {
      this.ensureDirectories();

      // Ensure registry.json remains lean and free of transcript bloat:
      const sanitizedClips = Array.from(this.virtualClips.values()).map((clip) => {
        const rawFile = this.rawFiles.get(clip.parentFileId);
        let transcriptPath = clip.transcriptPath;
        if (!transcriptPath && rawFile?.storagePath) {
          const ext = path.extname(rawFile.storagePath);
          const txtPath = rawFile.storagePath.slice(0, -ext.length) + '.txt';
          if (fs.existsSync(txtPath)) {
            transcriptPath = txtPath;
          }
        }

        const copy: any = { ...clip };
        delete copy.fullTranscription;
        if (transcriptPath) {
          copy.transcriptPath = transcriptPath;
          delete copy.transcription;
          delete copy.transcriptionChunks;
        }
        return copy;
      });

      const payload = {
        version: this.schemaVersion,
        settings: this.settings,
        rawFiles: Array.from(this.rawFiles.values()),
        virtualClips: sanitizedClips,
        deletedFiles: Array.from(this.deletedFiles.values()),
        collections: Array.from(this.collections.values()),
        importBatches: Array.from(this.importBatches.values()),
        savedViews: Array.from(this.savedViews.values()),
      };

      const jsonStr = JSON.stringify(payload, null, 2);

      // Atomic write: write to temp file then renameSync
      const tempFile = `${this.registryFile}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      fs.writeFileSync(tempFile, jsonStr, 'utf-8');
      fs.renameSync(tempFile, this.registryFile);

      // Keep a valid backup
      try {
        fs.writeFileSync(`${this.registryFile}.bak`, jsonStr, 'utf-8');
      } catch {}
    } catch (err) {
      console.error('Failed to save AudioVault registry:', err);
    }
  }

  // ==========================================
  // Collections, Batches, Views & Review Methods
  // ==========================================

  public getCollections(): CollectionRecord[] {
    return Array.from(this.collections.values());
  }

  public addCollection(col: CollectionRecord): void {
    this.collections.set(col.id, col);
    this.saveRegistry();
  }

  public deleteCollection(id: string): boolean {
    const col = this.collections.get(id);
    const existed = this.collections.delete(id);
    if (existed) {
      if (col) {
        for (const clip of this.virtualClips.values()) {
          if (clip.collections && clip.collections.includes(col.name)) {
            clip.collections = clip.collections.filter((c) => c !== col.name);
            clip.updatedAt = new Date().toISOString();
          }
        }
      }
      this.saveRegistry();
    }
    return existed;
  }

  public renameCollection(id: string, newName: string): boolean {
    const col = this.collections.get(id);
    if (!col) return false;
    const oldName = col.name;
    col.name = newName;
    col.updatedAt = new Date().toISOString();
    for (const clip of this.virtualClips.values()) {
      if (clip.collections && clip.collections.includes(oldName)) {
        clip.collections = clip.collections.map((c) => (c === oldName ? newName : c));
        clip.updatedAt = new Date().toISOString();
      }
    }
    this.saveRegistry();
    return true;
  }

  public batchAddClipsToCollection(clipIds: string[], collectionName: string): number {
    let count = 0;
    for (const id of clipIds) {
      const clip = this.virtualClips.get(id);
      if (clip) {
        clip.collections = clip.collections || [];
        if (!clip.collections.includes(collectionName)) {
          clip.collections.push(collectionName);
          clip.updatedAt = new Date().toISOString();
          count++;
        }
      }
    }
    if (count > 0) {
      this.saveRegistry();
    }
    return count;
  }

  public batchRemoveClipsFromCollection(clipIds: string[], collectionName: string): number {
    let count = 0;
    for (const id of clipIds) {
      const clip = this.virtualClips.get(id);
      if (clip && clip.collections) {
        const idx = clip.collections.indexOf(collectionName);
        if (idx >= 0) {
          clip.collections.splice(idx, 1);
          clip.updatedAt = new Date().toISOString();
          count++;
        }
      }
    }
    if (count > 0) {
      this.saveRegistry();
    }
    return count;
  }

  public getImportBatches(): ImportBatchRecord[] {
    return Array.from(this.importBatches.values()).sort(
      (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
    );
  }

  public addImportBatch(batch: ImportBatchRecord): void {
    this.importBatches.set(batch.id, batch);
    this.saveRegistry();
  }

  public updateImportBatch(id: string, updates: Partial<ImportBatchRecord>): ImportBatchRecord | undefined {
    const existing = this.importBatches.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.importBatches.set(id, updated);
    this.saveRegistry();
    return updated;
  }

  public getSavedViews(): SavedViewRecord[] {
    return Array.from(this.savedViews.values());
  }

  public addSavedView(view: SavedViewRecord): void {
    this.savedViews.set(view.id, view);
    this.saveRegistry();
  }

  public deleteSavedView(id: string): boolean {
    const existed = this.savedViews.delete(id);
    if (existed) {
      this.saveRegistry();
    }
    return existed;
  }

  public toggleFavorite(clipId: string): boolean {
    const clip = this.virtualClips.get(clipId);
    if (!clip) return false;
    clip.favorite = !clip.favorite;
    clip.updatedAt = new Date().toISOString();
    this.saveRegistry();
    return clip.favorite;
  }

  public toggleReviewed(clipId: string): boolean {
    const clip = this.virtualClips.get(clipId);
    if (!clip) return false;
    clip.reviewed = !clip.reviewed;
    clip.updatedAt = new Date().toISOString();
    this.saveRegistry();
    return clip.reviewed;
  }

  public addClipToCollection(clipId: string, collectionName: string): boolean {
    const clip = this.virtualClips.get(clipId);
    if (!clip) return false;
    clip.collections = clip.collections || [];
    if (!clip.collections.includes(collectionName)) {
      clip.collections.push(collectionName);
      clip.updatedAt = new Date().toISOString();
      this.saveRegistry();
    }
    return true;
  }

  public removeClipFromCollection(clipId: string, collectionName: string): boolean {
    const clip = this.virtualClips.get(clipId);
    if (!clip || !clip.collections) return false;
    const idx = clip.collections.indexOf(collectionName);
    if (idx >= 0) {
      clip.collections.splice(idx, 1);
      clip.updatedAt = new Date().toISOString();
      this.saveRegistry();
      return true;
    }
    return false;
  }

  /**
   * Generates a fast cryptographic fingerprint using the first 64KB header + file size + modification time.
   */
  public computeFileFingerprint(filePath: string): string {
    const stats = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const headerBuffer = Buffer.alloc(Math.min(65536, stats.size));
    fs.readSync(fd, headerBuffer, 0, headerBuffer.length, 0);
    fs.closeSync(fd);

    const hash = crypto.createHash('sha256');
    hash.update(headerBuffer);
    hash.update(stats.size.toString());
    hash.update(Math.floor(stats.mtimeMs).toString());
    return hash.digest('hex');
  }

  public isFingerprintImported(fingerprint: string, filePath?: string): boolean {
    for (const file of this.rawFiles.values()) {
      if (file.fingerprint === fingerprint) return true;
    }

    // Secondary checks if file path is provided and exists on disk (handles timestamp shifts on copied files)
    if (filePath && fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        let contentHash: string | null = null;

        for (const file of this.rawFiles.values()) {
          if (file.fileSizeBytes === stats.size && stats.size > 0) {
            if (file.originalFilename === fileName) {
              return true;
            }
            if (!contentHash) {
              contentHash = this.computeContentHash(filePath);
            }
            if (file.storagePath && fs.existsSync(file.storagePath)) {
              const existingHash = this.computeContentHash(file.storagePath);
              if (existingHash === contentHash) {
                return true;
              }
            }
          }
        }
      } catch {
        // ignore read/stat errors
      }
    }

    return false;
  }

  /**
   * Computes a content-only cryptographic hash using the first 64KB header + file size.
   * Unlike computeFileFingerprint, this does not depend on mtimeMs, making it robust against filesystem copy timestamp shifts.
   */
  public computeContentHash(filePath: string): string {
    const stats = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const headerBuffer = Buffer.alloc(Math.min(65536, stats.size));
    fs.readSync(fd, headerBuffer, 0, headerBuffer.length, 0);
    fs.closeSync(fd);

    const hash = crypto.createHash('sha256');
    hash.update(headerBuffer);
    hash.update(stats.size.toString());
    return hash.digest('hex');
  }

  /**
   * Checks if a file was previously deleted by the user so it won't be re-downloaded or re-uploaded during sync.
   */
  public isDeletedFile(fingerprint: string, filePath?: string): boolean {
    if (this.deletedFiles.has(fingerprint)) return true;

    // Secondary checks if file path is provided and exists on disk
    if (filePath && fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        const contentHash = this.computeContentHash(filePath);

        for (const record of this.deletedFiles.values()) {
          // 1. Content hash matches
          if (record.contentHash && record.contentHash === contentHash) {
            return true;
          }
          // 2. Exact original filename and byte size matches (for audio takes > 1KB)
          if (
            stats.size > 1024 &&
            record.fileSizeBytes === stats.size &&
            (record.originalFilename === fileName || fileName.endsWith(record.originalFilename))
          ) {
            return true;
          }
        }
      } catch (err) {
        // file stat error
      }
    }
    return false;
  }

  public recordDeletedFile(record: DeletedFileRecord): void {
    this.deletedFiles.set(record.fingerprint, record);
    this.saveRegistry();
    console.log(`[AudioVault Dedup] 🛡️ Tombstone recorded for deleted take: ${record.originalFilename} (${record.fingerprint.substring(0, 10)}...)`);
  }

  public getDeletedFiles(): DeletedFileRecord[] {
    return Array.from(this.deletedFiles.values());
  }

  public clearDeletedFiles(): void {
    this.deletedFiles.clear();
    this.saveRegistry();
    console.log('[AudioVault Dedup] 🧹 Cleared all deleted file tombstones.');
  }

  public forgetDeletedFile(idOrFingerprint: string): boolean {
    let deletedKey: string | null = null;
    for (const [fp, record] of this.deletedFiles.entries()) {
      if (fp === idOrFingerprint || record.id === idOrFingerprint) {
        deletedKey = fp;
        break;
      }
    }
    if (deletedKey) {
      this.deletedFiles.delete(deletedKey);
      this.saveRegistry();
      console.log(`[AudioVault Dedup] 🔓 Removed tombstone for: ${idOrFingerprint}`);
      return true;
    }
    return false;
  }

  public getRawFileByFingerprint(fingerprint: string): RawAudioFile | undefined {
    for (const file of this.rawFiles.values()) {
      if (file.fingerprint === fingerprint) return file;
    }
    return undefined;
  }

  public addRawFile(file: RawAudioFile): void {
    const existing = Array.from(this.rawFiles.values()).find(
      (r) =>
        (file.fingerprint && r.fingerprint === file.fingerprint) ||
        (file.storagePath && r.storagePath === file.storagePath)
    );
    if (existing) {
      const updated: RawAudioFile = {
        ...existing,
        ...file,
        id: existing.id,
        waveformPeaks:
          file.waveformPeaks && file.waveformPeaks.length > 0
            ? file.waveformPeaks
            : existing.waveformPeaks,
      };
      this.rawFiles.set(existing.id, updated);
      this.saveRegistry();
      return;
    }
    this.rawFiles.set(file.id, file);
    this.saveRegistry();
  }

  public getAllRawFiles(): RawAudioFile[] {
    return Array.from(this.rawFiles.values());
  }

  public getRawFile(id: string): RawAudioFile | undefined {
    return this.rawFiles.get(id);
  }

  public addVirtualClip(clip: VirtualClip): void {
    const existing = Array.from(this.virtualClips.values()).find(
      (c) =>
        c.parentFileId === clip.parentFileId &&
        Math.abs(c.startTimeSeconds - clip.startTimeSeconds) < 0.05 &&
        Math.abs(c.endTimeSeconds - clip.endTimeSeconds) < 0.05
    );
    if (existing) {
      const mergedTags = Array.from(new Set([...existing.userTags, ...clip.userTags]));
      const updated: VirtualClip = {
        ...existing,
        ...clip,
        id: existing.id,
        title: clip.title && !clip.title.startsWith('In-App Take') ? clip.title : existing.title,
        transcription: clip.transcription || existing.transcription,
        transcriptionChunks:
          clip.transcriptionChunks && clip.transcriptionChunks.length > 0
            ? clip.transcriptionChunks
            : existing.transcriptionChunks,
        userTags: mergedTags,
        updatedAt: new Date().toISOString(),
      };
      this.virtualClips.set(existing.id, updated);
      this.saveRegistry();
      return;
    }
    this.virtualClips.set(clip.id, clip);
    this.saveRegistry();
  }

  public getVirtualClips(): VirtualClip[] {
    return Array.from(this.virtualClips.values());
  }

  public getVirtualClip(id: string): VirtualClip | undefined {
    return this.virtualClips.get(id);
  }

  public getClipsForRawFile(rawFileId: string): VirtualClip[] {
    return Array.from(this.virtualClips.values()).filter((c) => c.parentFileId === rawFileId);
  }

  public updateVirtualClip(id: string, updates: Partial<VirtualClip>): VirtualClip | undefined {
    const clip = this.virtualClips.get(id);
    if (!clip) return undefined;

    let transcriptVersions = updates.transcriptVersions || clip.transcriptVersions || [];
    if (updates.editedTranscript !== undefined && updates.editedTranscript !== clip.editedTranscript) {
      const versions = [...transcriptVersions];
      if (versions.length === 0 && (clip.fullTranscription || clip.transcription)) {
        versions.push({
          id: `v_machine_init`,
          text: clip.fullTranscription || clip.transcription || '',
          source: 'machine',
          createdAt: clip.createdAt || new Date().toISOString(),
        });
      }
      if (updates.editedTranscript && updates.editedTranscript.trim()) {
        versions.push({
          id: `v_${Date.now()}_user`,
          text: updates.editedTranscript.trim(),
          source: 'user_edit',
          createdAt: new Date().toISOString(),
        });
      }
      transcriptVersions = versions;

      // Synchronize .edited.txt sidecar file
      const rawFile = this.rawFiles.get(clip.parentFileId);
      if (rawFile && rawFile.storagePath) {
        const ext = path.extname(rawFile.storagePath);
        const editedPath = rawFile.storagePath.slice(0, -ext.length) + '.edited.txt';
        try {
          if (updates.editedTranscript && updates.editedTranscript.trim()) {
            fs.writeFileSync(editedPath, updates.editedTranscript.trim(), 'utf-8');
            console.log(`[AudioVault Dedup] 📝 Saved edited transcript sidecar: ${editedPath}`);
          } else if (fs.existsSync(editedPath)) {
            fs.unlinkSync(editedPath);
            console.log(`[AudioVault Dedup] 🗑️ Removed edited transcript sidecar: ${editedPath}`);
          }
        } catch (err) {
          console.warn('[AudioVault Dedup] Failed updating .edited.txt sidecar:', err);
        }
      }
    }

    const updated = {
      ...clip,
      ...updates,
      transcriptVersions,
      updatedAt: new Date().toISOString(),
    };
    this.virtualClips.set(id, updated);
    this.saveRegistry();
    return updated;
  }

  public deleteVirtualClip(id: string, deleteFromDisk: boolean = true): boolean {
    const clip = this.virtualClips.get(id);
    if (!clip) return false;

    const rawFileId = clip.parentFileId;
    const rawFile = this.rawFiles.get(rawFileId);

    if (rawFile) {
      // Compute content hash before potentially removing file from disk
      let contentHash: string | undefined;
      if (rawFile.storagePath && fs.existsSync(rawFile.storagePath)) {
        try {
          contentHash = this.computeContentHash(rawFile.storagePath);
        } catch (err) {
          // ignore
        }
      }

      // Record tombstone so this take will never be re-downloaded/re-uploaded during sync
      const tombstone: DeletedFileRecord = {
        id: `del_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        fingerprint: rawFile.fingerprint,
        contentHash,
        originalFilename: rawFile.originalFilename,
        fileSizeBytes: rawFile.fileSizeBytes,
        deletedAt: new Date().toISOString(),
        title: clip.title,
        reason: 'user_deleted',
      };
      this.deletedFiles.set(rawFile.fingerprint, tombstone);
      console.log(`[AudioVault Dedup] 🛡️ Tombstone recorded for deleted take: ${rawFile.originalFilename} (${rawFile.fingerprint.substring(0, 10)}...)`);
    }

    if (deleteFromDisk) {
      // 1. Remove exported MP3 if it exists on disk
      if (clip.exportedMp3Path && fs.existsSync(clip.exportedMp3Path)) {
        try {
          fs.unlinkSync(clip.exportedMp3Path);
          console.log(`[AudioVault Dedup] 🗑️ Deleted exported file from disk: ${clip.exportedMp3Path}`);
        } catch (err) {
          console.warn(`[AudioVault Dedup] Failed to delete exported file: ${clip.exportedMp3Path}`, err);
        }
      }

      // 2. Check if any other clips in the registry still reference this parent raw audio file
      const otherClips = Array.from(this.virtualClips.values()).filter(
        (c) => c.id !== id && c.parentFileId === rawFileId
      );

      // If no other clips reference this raw file, delete the raw audio file from disk & registry
      if (otherClips.length === 0 && rawFile) {
        if (rawFile.storagePath && fs.existsSync(rawFile.storagePath)) {
          try {
            fs.unlinkSync(rawFile.storagePath);
            console.log(`[AudioVault Dedup] 🗑️ Deleted raw audio file from disk: ${rawFile.storagePath}`);
            const ext = path.extname(rawFile.storagePath);
            const transcriptPath = rawFile.storagePath.slice(0, -ext.length) + '.txt';
            if (fs.existsSync(transcriptPath)) {
              fs.unlinkSync(transcriptPath);
              console.log(`[AudioVault Dedup] 🗑️ Deleted transcript file from disk: ${transcriptPath}`);
            }
            const editedTranscriptPath = rawFile.storagePath.slice(0, -ext.length) + '.edited.txt';
            if (fs.existsSync(editedTranscriptPath)) {
              fs.unlinkSync(editedTranscriptPath);
              console.log(`[AudioVault Dedup] 🗑️ Deleted edited transcript file from disk: ${editedTranscriptPath}`);
            }
          } catch (err) {
            console.warn(`[AudioVault Dedup] Failed to delete raw audio file: ${rawFile.storagePath}`, err);
          }
        }
        this.rawFiles.delete(rawFileId);
      }
    }

    const existed = this.virtualClips.delete(id);
    if (existed) this.saveRegistry();
    return existed;
  }

  public restoreExcludedClip(id: string): VirtualClip | null {
    return this.updateVirtualClip(id, { isExcluded: false }) ?? null;
  }

  public getVaultStats(): VaultStats {
    let totalSizeBytes = 0;
    let rawFilesCount = 0;
    let exportsCount = 0;

    const rawDir = this.getRawDir();
    if (fs.existsSync(rawDir)) {
      const files = fs.readdirSync(rawDir);
      rawFilesCount = files.filter((f) => !f.startsWith('.')).length;
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(rawDir, f));
          totalSizeBytes += st.size;
        } catch {}
      }
    }

    const exportsDir = this.getExportsDir();
    if (fs.existsSync(exportsDir)) {
      const files = fs.readdirSync(exportsDir);
      exportsCount = files.filter((f) => !f.startsWith('.')).length;
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(exportsDir, f));
          totalSizeBytes += st.size;
        } catch {}
      }
    }

    if (fs.existsSync(this.registryFile)) {
      try {
        const st = fs.statSync(this.registryFile);
        totalSizeBytes += st.size;
      } catch {}
    }

    const clips = Array.from(this.virtualClips.values());
    const excludedCount = clips.filter((c) => c.isExcluded).length;

    return {
      vaultDirectory: this.vaultDir,
      totalRecordings: clips.length - excludedCount,
      excludedCount,
      totalSizeBytes,
      rawFilesCount,
      exportsCount,
    };
  }

  public async moveVault(targetDir: string): Promise<boolean> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const prodVault = path.join(homeDir, 'Music', 'AudioVault');
    const isTestMode =
      process.env.AUDIOVAULT_TEST_MODE === '1' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true';

    if (isTestMode && path.resolve(targetDir) === path.resolve(prodVault)) {
      throw new Error(
        `[AudioVault Hard Guard] Attempted to move vault to production vault during test mode: "${targetDir}". Strictly forbidden.`
      );
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const oldVaultDir = this.vaultDir;
    const oldRawDir = this.getRawDir();
    const oldExportsDir = this.getExportsDir();

    const newRawDir = path.join(targetDir, 'raw');
    const newExportsDir = path.join(targetDir, 'exports');

    if (!fs.existsSync(newRawDir)) fs.mkdirSync(newRawDir, { recursive: true });
    if (!fs.existsSync(newExportsDir)) fs.mkdirSync(newExportsDir, { recursive: true });

    // 1. Copy raw audio files and sidecars
    if (fs.existsSync(oldRawDir)) {
      const rawEntries = fs.readdirSync(oldRawDir);
      for (const entry of rawEntries) {
        const srcFile = path.join(oldRawDir, entry);
        const destFile = path.join(newRawDir, entry);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, destFile);
        }
      }
    }

    // 2. Copy exports files
    if (fs.existsSync(oldExportsDir)) {
      const exportEntries = fs.readdirSync(oldExportsDir);
      for (const entry of exportEntries) {
        const srcFile = path.join(oldExportsDir, entry);
        const destFile = path.join(newExportsDir, entry);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, destFile);
        }
      }
    }

    // 3. Update paths in memory
    for (const rawFile of this.rawFiles.values()) {
      if (rawFile.storagePath.startsWith(oldVaultDir)) {
        rawFile.storagePath = path.join(targetDir, path.relative(oldVaultDir, rawFile.storagePath));
      }
    }
    for (const clip of this.virtualClips.values()) {
      if (clip.transcriptPath && clip.transcriptPath.startsWith(oldVaultDir)) {
        clip.transcriptPath = path.join(targetDir, path.relative(oldVaultDir, clip.transcriptPath));
      }
      if (clip.exportedMp3Path && clip.exportedMp3Path.startsWith(oldVaultDir)) {
        clip.exportedMp3Path = path.join(targetDir, path.relative(oldVaultDir, clip.exportedMp3Path));
      }
    }

    // 4. Update vaultDir and save registry atomically at new location
    this.vaultDir = targetDir;
    this.registryFile = path.join(targetDir, 'registry.json');
    this.settings.vaultDirectory = targetDir;
    this.saveRegistry();

    return true;
  }

  public async openVault(targetDir: string): Promise<boolean> {
    this.updateSettings({ vaultDirectory: targetDir });
    return true;
  }
}

