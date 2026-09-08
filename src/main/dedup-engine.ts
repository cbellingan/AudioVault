import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RawAudioFile, VirtualClip, VaultSettings } from '../shared/types';

export class DedupEngine {
  private vaultDir: string;
  private registryFile: string;
  private rawFiles: Map<string, RawAudioFile> = new Map();
  private virtualClips: Map<string, VirtualClip> = new Map();
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

  private ensureDirectories() {
    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true });
    }
    const rawDir = this.getRawDir();
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }
  }

  private loadRegistry() {
    try {
      if (fs.existsSync(this.registryFile)) {
        const raw = fs.readFileSync(this.registryFile, 'utf-8');
        const data = JSON.parse(raw);
        if (data.rawFiles) {
          for (const item of data.rawFiles) {
            this.rawFiles.set(item.id, item);
          }
        }
        if (data.virtualClips) {
          for (const item of data.virtualClips) {
            this.virtualClips.set(item.id, item);
          }
        }
        if (data.settings) {
          this.settings = { ...this.settings, ...data.settings };
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

  public addRawFile(file: RawAudioFile): void {
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
    this.virtualClips.set(clip.id, clip);
    this.saveRegistry();
  }

  public getVirtualClips(): VirtualClip[] {
    return Array.from(this.virtualClips.values());
  }

  public updateVirtualClip(id: string, updates: Partial<VirtualClip>): VirtualClip | undefined {
    const clip = this.virtualClips.get(id);
    if (!clip) return undefined;
    const updated = { ...clip, ...updates, updatedAt: new Date().toISOString() };
    this.virtualClips.set(id, updated);
    this.saveRegistry();
    return updated;
  }

  public deleteVirtualClip(id: string): boolean {
    const existed = this.virtualClips.delete(id);
    if (existed) this.saveRegistry();
    return existed;
  }
}
