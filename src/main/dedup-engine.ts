import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RawAudioFile, VirtualClip, VaultSettings, DeletedFileRecord } from '../shared/types';

export class DedupEngine {
  private vaultDir: string;
  private registryFile: string;
  private rawFiles: Map<string, RawAudioFile> = new Map();
  private virtualClips: Map<string, VirtualClip> = new Map();
  private deletedFiles: Map<string, DeletedFileRecord> = new Map();
  private settings: VaultSettings;

  constructor(customVaultDir?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    this.vaultDir = customVaultDir || path.join(homeDir, 'Music', 'AudioVault');
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
      if (fs.existsSync(this.registryFile)) {
        const raw = fs.readFileSync(this.registryFile, 'utf-8');
        const data = JSON.parse(raw);
        let registryNeedsSave = false;

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
              // Found duplicate raw file entry! Map its ID to primary
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
            // Remap parentFileId if referencing a duplicate raw file
            if (rawIdRemap.has(item.parentFileId)) {
              item.parentFileId = rawIdRemap.get(item.parentFileId)!;
              registryNeedsSave = true;
            }

            // Look for existing clip for this raw file covering the exact same span (within 0.05s)
            const existing = Array.from(this.virtualClips.values()).find(
              (c) =>
                c.parentFileId === item.parentFileId &&
                Math.abs(c.startTimeSeconds - item.startTimeSeconds) < 0.05 &&
                Math.abs(c.endTimeSeconds - item.endTimeSeconds) < 0.05
            );

            if (existing) {
              registryNeedsSave = true;
              // Merge details: retain best title, transcription, tags, notes, export path
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

        if (data.settings) {
          this.settings = { ...this.settings, ...data.settings };
        }

        if (registryNeedsSave) {
          console.log('[AudioVault Dedup] 🧹 Auto-cleaned duplicate takes/clips from registry.');
          this.saveRegistry();
        }
      }
    } catch (err) {
      console.error('Failed to load AudioVault registry:', err);
    }
  }

  public saveRegistry() {
    try {
      this.ensureDirectories();
      const payload = {
        settings: this.settings,
        rawFiles: Array.from(this.rawFiles.values()),
        virtualClips: Array.from(this.virtualClips.values()),
        deletedFiles: Array.from(this.deletedFiles.values()),
      };
      fs.writeFileSync(this.registryFile, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save AudioVault registry:', err);
    }
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

  public isFingerprintImported(fingerprint: string): boolean {
    for (const file of this.rawFiles.values()) {
      if (file.fingerprint === fingerprint) return true;
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
    const updated = { ...clip, ...updates, updatedAt: new Date().toISOString() };
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
}
