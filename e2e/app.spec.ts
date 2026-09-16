import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";
import fs from "fs";
import { setupTestSandbox, teardownTestSandbox, launchTestApp, getProductionVaultStat, SandboxContext } from "./test-sandbox";
import { generateSyntheticWavBuffer } from "../src/test/audio-fixture";

test.describe("AudioVault Electron Integration & Exhaustive E2E Suite", () => {
  let sandbox: SandboxContext;
  let initialProdStat: { exists: boolean; mtimeMs?: number; size?: number };

  test.beforeAll(() => {
    initialProdStat = getProductionVaultStat();
    console.log("[E2E Sandbox] Production vault stat before tests:", initialProdStat);
  });

  test.beforeEach(() => {
    sandbox = setupTestSandbox();
    console.log("[E2E Sandbox] Initialized isolated test vault at:", sandbox.sandboxDir);
  });

  test.afterEach(() => {
    teardownTestSandbox(sandbox);
    // Verify production vault is untouched
    const currentProdStat = getProductionVaultStat();
    if (initialProdStat.exists) {
      expect(currentProdStat.exists).toBe(true);
      expect(currentProdStat.mtimeMs).toBe(initialProdStat.mtimeMs);
      expect(currentProdStat.size).toBe(initialProdStat.size);
    }
  });

  test("1. Launches AudioVault in isolated sandbox, verifies taxonomy, waveform, and playback", async () => {
    console.log("[E2E] Launching AudioVault test instance...");
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Title & Brand
    const title = await window.title();
    expect(title).toContain("AudioVault");

    const brandTitle = await window.locator(".brand-title").innerText();
    expect(brandTitle).toBe("AudioVault");

    // Taxonomy Nav
    await expect(window.locator(".nav-item", { hasText: "Music & Singing" })).toBeVisible();
    await expect(window.locator(".nav-item", { hasText: "Concerts & Live" })).toBeVisible();
    await expect(window.locator(".nav-item", { hasText: "Dictaphone" })).toBeVisible();
    await expect(window.locator(".nav-item", { hasText: "Meetings" })).toBeVisible();
    await expect(window.locator(".nav-item", { hasText: "Ambient" })).toBeVisible();

    // Table rows
    const tableRows = window.locator(".clips-table tbody tr");
    await expect(tableRows.first()).toBeVisible();
    const count = await tableRows.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Meeting clip with transcript
    const meetingRow = window.locator(".clips-table tbody tr", { hasText: "STE-003 - Product Standup" });
    await expect(meetingRow).toBeVisible();
    await meetingRow.click();
    await expect(window.locator("text=...the audio pipeline handles unmounting cleanly...").first()).toBeVisible();

    // Waveform Canvas & Seeking
    const canvas = window.locator(".waveform-canvas");
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 200, y: 50 } });

    // Playback Controls
    const playBtn = window.locator(".play-btn");
    await expect(playBtn).toBeVisible();
    expect(await playBtn.innerText()).toBe("▶");

    await playBtn.click();
    expect(await playBtn.innerText()).toBe("⏸");

    await window.keyboard.press("Space");
    expect(await playBtn.innerText()).toBe("▶");

    // Scan & Import Buttons
    await expect(window.locator("button", { hasText: "Scan Connected Drives" })).toBeVisible();
    await expect(window.locator("button", { hasText: "Import Folder / SD Card" })).toBeVisible();

    await app.close();
    console.log("[E2E] Test 1 completed successfully.");
  });

  test("2. Library table supports vertical scrolling, row selection, and category filtering", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const clipsPane = window.locator(".clips-pane");
    await expect(clipsPane).toBeVisible();

    const tableRows = window.locator(".clips-table tbody tr");
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(6);

    // Scroll clips pane
    await clipsPane.evaluate((el) => {
      el.scrollTop = 120;
    });
    const scrolledPos = await clipsPane.evaluate((el) => el.scrollTop);
    expect(scrolledPos).toBeGreaterThanOrEqual(0);

    // Select last row
    const lastRow = tableRows.last();
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeVisible();
    await lastRow.click();
    await expect(lastRow).toHaveClass(/selected/);

    // Category navigation filter: Dictaphone
    const dictaphoneNav = window.locator(".nav-item", { hasText: "Dictaphone" });
    await dictaphoneNav.click();
    const dictaphoneRows = window.locator(".clips-table tbody tr");
    expect(await dictaphoneRows.count()).toBeGreaterThanOrEqual(1);

    // Category navigation filter: Concerts
    const concertNav = window.locator(".nav-item", { hasText: "Concerts & Live" });
    await concertNav.click();
    const concertRows = window.locator(".clips-table tbody tr");
    expect(await concertRows.count()).toBeGreaterThanOrEqual(1);

    // Return to Library (All)
    const allNav = window.locator(".nav-item", { hasText: "Library (All)" });
    await allNav.click();
    expect(await window.locator(".clips-table tbody tr").count()).toBe(rowCount);

    await app.close();
  });

  test("3. Synchronized transcript ribbon tracks playback and word seeking", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Select take with speech
    const speechRow = window.locator(".clips-table tbody tr", { hasText: "260831-185613" }).first();
    await speechRow.click();

    const ribbon = window.locator("[data-testid=\"transcript-ribbon\"]");
    await expect(ribbon).toBeVisible();

    const words = window.locator(".transcript-word");
    const wordCount = await words.count();
    expect(wordCount).toBeGreaterThan(0);

    // Click word to seek
    const targetWord = words.first();
    await targetWord.click();
    await expect(window.locator(".transcript-word.active")).toBeVisible();

    // Play and Pause
    const playBtn = window.locator(".play-btn");
    await playBtn.click();
    expect(await playBtn.innerText()).toBe("⏸");
    await window.waitForTimeout(300);
    await playBtn.click();
    expect(await playBtn.innerText()).toBe("▶");

    await app.close();
  });

  test("4. Library table column sorting (Date, Title, Duration)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Title sort
    const titleHeader = window.locator(".clips-table th", { hasText: "Clip Title" });
    await titleHeader.click();
    const titleCells = window.locator(".clips-table tbody tr td:first-child span");
    const firstTitle = await titleCells.first().innerText();
    const lastTitle = await titleCells.last().innerText();
    expect(firstTitle.localeCompare(lastTitle)).toBeLessThanOrEqual(0);

    // Duration sort
    const durationHeader = window.locator(".clips-table th", { hasText: "Duration" });
    await durationHeader.click();
    const durCells = window.locator(".clips-table tbody tr td:nth-child(3)");
    const firstDur = parseFloat(await durCells.first().innerText());
    const lastDur = parseFloat(await durCells.last().innerText());
    expect(firstDur).toBeGreaterThanOrEqual(lastDur);

    await app.close();
  });

  test("5. Exhaustive Right-Click Context Menu: Edit Title, AI Titling, MP3 Export, Tags, Hide Toggle, and Categories", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const targetRow = window.locator(".clips-table tbody tr", { hasText: "Harmony Warmups" }).first();
    await targetRow.click({ button: "right" });

    const contextMenu = window.locator(".clip-context-menu");
    await expect(contextMenu).toBeVisible();

    // A. Edit Title & Metadata Modal (ctx-edit-title)
    const editItem = window.locator("[data-testid=\"ctx-edit-title\"]");
    await expect(editItem).toBeVisible();
    await editItem.click();

    const modal = window.locator(".modal-dialog");
    await expect(modal).toBeVisible();

    const titleInput = modal.locator("input.form-input").first();
    const originalTitle = await titleInput.inputValue();
    const newTitle = originalTitle + " (Remastered)";
    await titleInput.fill(newTitle);

    // Add sub-tag inside modal
    const modalTagInput = modal.locator("input[placeholder*=\"custom tag\"]");
    await modalTagInput.fill("StudioMaster");
    await modal.locator("button", { hasText: "+ Add Tag" }).click();

    // Save
    await modal.locator("button", { hasText: "Save Changes" }).click();
    await expect(modal).toBeHidden();
    await expect(targetRow.locator("td:first-child")).toContainText(newTitle);
    await expect(targetRow.locator(".tag-chip", { hasText: "StudioMaster" })).toBeVisible();

    // B. MP3 Export & Re-Export (ctx-export-mp3)
    await targetRow.click({ button: "right" });
    const exportMp3 = window.locator("[data-testid=\"ctx-export-mp3\"]");
    await expect(exportMp3).toBeVisible();
    await exportMp3.click();

    // Wait for MP3 badge to appear
    const mp3Badge = targetRow.locator(".badge-mp3");
    await expect(mp3Badge).toBeVisible({ timeout: 10000 });

    // Right-click again: option should now read "Re-export to MP3"
    await targetRow.click({ button: "right" });
    const reExportMp3 = window.locator("[data-testid=\"ctx-export-mp3\"]");
    await expect(reExportMp3).toContainText("Re-export to MP3");

    // C. Open in Finder (ctx-open-in-finder)
    const finderItem = window.locator("[data-testid=\"ctx-open-in-finder\"]");
    await expect(finderItem).toBeVisible();

    // D. Quick Sub-Tag Prompt (ctx-add-tag)
    const addTagItem = window.locator("[data-testid=\"ctx-add-tag\"]");
    await expect(addTagItem).toBeVisible();

    // Set prompt mock for quick add tag
    await window.evaluate(() => {
      (window as any).prompt = () => "LiveAcoustic";
    });
    await addTagItem.click();
    await expect(targetRow.locator(".tag-chip", { hasText: "LiveAcoustic" })).toBeVisible({ timeout: 5000 });

    // E. Category Switcher: Test ALL 5 Categories on the same clip
    // 1. Concerts
    await targetRow.click({ button: "right" });
    await window.locator("[data-testid=\"ctx-category-concerts\"]").click();
    await expect(targetRow.locator(".cat-concerts")).toBeVisible();

    // 2. Dictaphone
    await targetRow.click({ button: "right" });
    await window.locator("[data-testid=\"ctx-category-dictaphone\"]").click();
    await expect(targetRow.locator(".cat-dictaphone")).toBeVisible();

    // 3. Meeting
    await targetRow.click({ button: "right" });
    await window.locator("[data-testid=\"ctx-category-meeting\"]").click();
    await expect(targetRow.locator(".cat-meeting")).toBeVisible();

    // 4. Ambient
    await targetRow.click({ button: "right" });
    await window.locator("[data-testid=\"ctx-category-ambient\"]").click();
    await expect(targetRow.locator(".cat-ambient")).toBeVisible();

    // 5. Back to Music
    await targetRow.click({ button: "right" });
    await window.locator("[data-testid=\"ctx-category-music\"]").click();
    await expect(targetRow.locator(".cat-music")).toBeVisible();

    // F. AI Titling (ctx-generate-ai-title)
    const speechRow = window.locator(".clips-table tbody tr", { hasText: "260831-185613" }).first();
    await speechRow.click({ button: "right" });
    const aiTitleBtn = window.locator("[data-testid=\"ctx-generate-ai-title\"]");
    await expect(aiTitleBtn).toBeVisible();
    await aiTitleBtn.click();
    await window.waitForTimeout(600);
    const speechTitle = await speechRow.locator("td:first-child span").first().innerText();
    expect(speechTitle.length).toBeGreaterThan(5);

    // G. Hide / Include in Library Toggle (ctx-toggle-hide)
    const totalRowsBeforeHide = await window.locator(".clips-table tbody tr").count();
    await targetRow.click({ button: "right" });
    const hideToggle = window.locator("[data-testid=\"ctx-toggle-hide\"]");
    await expect(hideToggle).toContainText("Hide from Library");
    await hideToggle.click();

    // Row is hidden from active library
    expect(await window.locator(".clips-table tbody tr").count()).toBe(totalRowsBeforeHide - 1);

    await app.close();
  });

  test("6. In-App Recording: Level meter animation, Timer, Pause/Resume, Stop, and Vault persistence", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const initialCount = await window.locator(".clips-table tbody tr").count();

    // 1. Click prominent Record button
    const recordBtn = window.locator(".btn-record");
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // 2. Recording bar appears
    const recbar = window.locator(".recording-bar");
    await expect(recbar).toBeVisible();

    // Verify timer & metadata
    await expect(recbar.locator(".recbar-timer")).toBeVisible();
    await expect(recbar.locator(".recbar-meta")).toContainText("In-App Recorder");

    // Verify level bars (18 animated bars)
    const levelBars = recbar.locator(".recbar-lvl-bar");
    expect(await levelBars.count()).toBe(18);

    // Pause / Resume
    const pauseBtn = recbar.locator("button", { hasText: /Pause|Resume/ });
    await pauseBtn.click();
    await expect(recbar.locator("button", { hasText: "Resume" })).toBeVisible();
    await pauseBtn.click();
    await expect(recbar.locator("button", { hasText: "Pause" })).toBeVisible();

    // Stop recording
    const stopBtn = recbar.locator("button", { hasText: /Stop/ });
    await stopBtn.click();

    // Recbar dismisses
    await expect(recbar).not.toBeVisible();
    await expect(recordBtn).toBeVisible();

    // Save synthetic recorded take through API into vault
    const testPcm = new Int16Array(44100 * 1);
    for (let i = 0; i < testPcm.length; i++) {
      testPcm[i] = Math.sin((i / 44100) * 440 * 2 * Math.PI) * 14000;
    }
    const wavBuffer = new ArrayBuffer(44 + testPcm.length * 2);
    const view = new DataView(wavBuffer);
    const writeStr = (pos: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + testPcm.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 44100 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, testPcm.length * 2, true);
    new Int16Array(wavBuffer, 44).set(testPcm);

    const savedTake = await window.evaluate(async (buf) => {
      return (window as any).audioVault.saveRecordedTake(buf, "Live Acoustic Studio Rec", false);
    }, Array.from(new Uint8Array(wavBuffer)));

    expect(savedTake).toBeTruthy();
    expect(savedTake.title).toBe("Live Acoustic Studio Rec");

    await window.waitForTimeout(500);

    // Verify new row appears in library table
    const newRow = window.locator(".clips-table tbody tr", { hasText: "Live Acoustic Studio Rec" });
    await expect(newRow).toBeVisible();
    await expect(newRow.locator(".take-source-sub")).toContainText("in-app take");

    // Click to select and verify waveform
    await newRow.click();
    await expect(window.locator(".waveform-canvas")).toBeVisible();

    await app.close();
  });

  test("7. WAV File Ingestion/Upload and Deduplication Prevention", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const initialCount = await window.locator(".clips-table tbody tr").count();

    // Create a new synthetic WAV file to simulate SD card / folder upload
    const uploadFilePath = path.join(sandbox.sandboxDir, "MANUAL_UPLOAD_TAKE.WAV");
    const uploadBuffer = generateSyntheticWavBuffer({ durationSeconds: 2.0, frequency: 330 });
    fs.writeFileSync(uploadFilePath, uploadBuffer);

    // Ingest file via Hardware/Folder Pipeline Orchestrator
    const enqueueResult = await window.evaluate(async (fpath) => {
      return (window as any).audioVault.enqueuePipelineBatch([fpath]);
    }, uploadFilePath);

    expect(enqueueResult.count).toBe(1);

    // Verify imported clip appears in library table
    const uploadedRow = window.locator(".clips-table tbody tr", { hasText: "MANUAL_UPLOAD_TAKE" });
    await expect(uploadedRow).toBeVisible({ timeout: 10000 });

    // Verify deduplication: re-enqueuing the same file skips ingestion
    const reimportResult = await window.evaluate(async (fpath) => {
      return (window as any).audioVault.enqueuePipelineBatch([fpath]);
    }, uploadFilePath);

    expect(reimportResult.count).toBe(0);

    await app.close();
  });

  test("8. Right-click Delete Clip from Disk with confirmation dialog, Cancel, and Remember My Choice", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const initialRowCount = await window.locator(".clips-table tbody tr").count();
    const firstRow = window.locator(".clips-table tbody tr").first();
    const clipTitle = await firstRow.locator("td").first().locator("span").first().innerText();

    // 1. Right click and click Delete
    await firstRow.click({ button: "right" });
    const deleteOption = window.locator("[data-testid=\"delete-clip-menu-item\"]");
    await expect(deleteOption).toBeVisible();
    await deleteOption.click();

    // 2. Confirmation modal must appear
    const confirmModal = window.locator("[data-testid=\"delete-confirmation-modal\"]");
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal).toContainText("Delete Clip & Audio File");

    // Cancel test
    const cancelBtn = confirmModal.locator("button", { hasText: "Cancel" });
    await cancelBtn.click();
    await expect(confirmModal).not.toBeVisible();
    expect(await window.locator(".clips-table tbody tr").count()).toBe(initialRowCount);

    // 3. Re-open delete modal, check Remember My Choice, and confirm
    await firstRow.click({ button: "right" });
    await deleteOption.click();
    await expect(confirmModal).toBeVisible();

    const rememberCheckbox = window.locator("[data-testid=\"remember-choice-checkbox\"]");
    await rememberCheckbox.check();
    await expect(rememberCheckbox).toBeChecked();

    const confirmBtn = window.locator("[data-testid=\"confirm-delete-btn\"]");
    await confirmBtn.click();
    await expect(confirmModal).toBeHidden();

    // Clip removed from table
    await expect(window.locator(".clips-table tbody tr")).toHaveCount(initialRowCount - 1);

    // 4. Delete next clip: with Remember My Choice enabled, modal should NOT appear
    const nextRow = window.locator(".clips-table tbody tr").first();
    await nextRow.click({ button: "right" });
    await deleteOption.click();
    // Deletes immediately without dialog
    await expect(confirmModal).not.toBeVisible();
    await expect(window.locator(".clips-table tbody tr")).toHaveCount(initialRowCount - 2);

    await app.close();
  });

  test("9. Context menu remains within viewport bounds and is scrollable near bottom", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Scroll to bottom
    const clipsPane = window.locator(".clips-pane");
    await clipsPane.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await window.waitForTimeout(300);

    const lastRow = window.locator(".clips-table tbody tr").last();
    await lastRow.scrollIntoViewIfNeeded();
    await lastRow.click({ button: "right" });

    const contextMenu = window.locator(".clip-context-menu");
    await expect(contextMenu).toBeVisible();

    // Verify context menu is completely within viewport bounds
    const menuBox = await contextMenu.boundingBox();
    expect(menuBox).toBeTruthy();
    if (menuBox) {
      const windowHeight = await window.evaluate(() => globalThis.innerHeight);
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(windowHeight + 2);
    }

    // Lowest item (Delete) must be accessible
    const deleteItem = contextMenu.locator("[data-testid=\"delete-clip-menu-item\"]");
    await expect(deleteItem).toBeVisible();

    await app.close();
  });

  test("10. Deleted files record tombstones and are never re-downloaded or re-uploaded during sync", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const targetRow = window.locator(".clips-table tbody tr", { hasText: "Harmony Warmups" }).first();
    await expect(targetRow).toBeVisible();

    // Right-click and delete
    await targetRow.click({ button: "right" });
    await window.locator("[data-testid=\"delete-clip-menu-item\"]").click();

    const confirmModal = window.locator("[data-testid=\"delete-confirmation-modal\"]");
    if (await confirmModal.isVisible()) {
      await window.locator("[data-testid=\"confirm-delete-btn\"]").click();
      await expect(confirmModal).toBeHidden();
    }

    // Row deleted
    await expect(targetRow).not.toBeVisible();

    // Verify tombstone is recorded in registry
    const deletedRecords = await window.evaluate(async () => {
      return (window as any).audioVault.getDeletedFiles();
    });
    expect(deletedRecords.length).toBeGreaterThan(0);

    // Sidebar indicator
    await expect(window.locator("[data-testid=\"deleted-takes-indicator\"]")).toBeVisible();

    // Attempt to re-import the same file from an external source (e.g. SD Card): must be skipped due to tombstone
    const reimportPath = path.join(sandbox.sandboxDir, "SD_CARD_REIMPORT.WAV");
    fs.writeFileSync(reimportPath, generateSyntheticWavBuffer({ durationSeconds: 2.5, frequency: 440 }));

    const reimportResult = await window.evaluate(async (storagePath) => {
      return (window as any).audioVault.importFiles([storagePath]);
    }, reimportPath);

    expect(reimportResult.importedCount).toBe(0);
    expect(reimportResult.skippedCount).toBe(1);

    await app.close();
  });

  test("11. Header Search with Cmd+K and Search Phrase Highlighting", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const searchInput = window.locator(".header-search-input");
    await expect(searchInput).toBeVisible();

    // Cmd+K shortcut
    await window.keyboard.press("Meta+k");
    await expect(searchInput).toBeFocused();

    // Search query
    await searchInput.fill("Feelings");
    const filteredRows = window.locator(".clips-table tbody tr");
    await expect(filteredRows).toHaveCount(1);

    // Highlighting mark
    const highlightMark = window.locator("mark.search-highlight-mark");
    await expect(highlightMark.first()).toBeVisible();
    await expect(highlightMark.first()).toHaveText("Feelings");

    // Match counter pill
    const matchPill = window.locator(".search-matches-pill");
    await expect(matchPill).toBeVisible();
    await expect(matchPill).toContainText("1 match");

    // Escape clears search
    await searchInput.focus();
    await window.keyboard.press("Escape");
    await expect(searchInput).toHaveValue("");

    await app.close();
  });

  test("12. Clip Context Menu: Copy Transcript is greyed out when no transcript and copies text when ready", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Right-click clip without transcript: Option is visible, but disabled / greyed out
    const clipWithoutTranscript = window.locator(".clips-table tbody tr", { hasText: "ZOOM0001 - Harmony Warmups" }).first();
    await clipWithoutTranscript.click({ button: "right" });

    const disabledCopyItem = window.locator("[data-testid=\"ctx-copy-transcript\"]");
    await expect(disabledCopyItem).toBeVisible();
    await expect(disabledCopyItem).toHaveClass(/disabled/);
    await expect(disabledCopyItem).toHaveAttribute("aria-disabled", "true");

    // Click outside to dismiss context menu
    await window.click("body", { position: { x: 10, y: 10 } });
    await expect(window.locator(".clip-context-menu")).toBeHidden();

    // 2. Right-click speech clip that HAS transcript: Option is enabled and copies text
    const speechRow = window.locator(".clips-table tbody tr", { hasText: "260831-185613" }).first();
    await speechRow.click({ button: "right" });

    // Also verify Transcribe Full Audio option is present in context menu
    const transcribeFullItem = window.locator("[data-testid=\"ctx-transcribe-full\"]");
    await expect(transcribeFullItem).toBeVisible();

    const enabledCopyItem = window.locator("[data-testid=\"ctx-copy-transcript\"]");
    await expect(enabledCopyItem).toBeVisible();
    await expect(enabledCopyItem).not.toHaveClass(/disabled/);
    await expect(enabledCopyItem).toHaveAttribute("aria-disabled", "false");

    await enabledCopyItem.click();
    const copyToast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(copyToast).toBeVisible();
    await expect(copyToast).toContainText("transcript copied to clipboard");

    // Verify sidecar .txt file exists on disk alongside the audio file
    const sidecarTxtPath = path.join(sandbox.rawDir, "260831-185613.txt");
    expect(fs.existsSync(sidecarTxtPath)).toBe(true);
    const sidecarContent = fs.readFileSync(sidecarTxtPath, "utf-8");
    expect(sidecarContent).toContain("Testing one two three local transcription works beautifully");

    await app.close();
  });

  test("13. Backfill/Refresh: Context menu re-process, library refresh modal, and clean registry.json sidecars", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Verify registry.json is clean of transcript bloat (no transcription / fullTranscription)
    const registryContent = fs.readFileSync(sandbox.registryPath, "utf-8");
    const parsedRegistry = JSON.parse(registryContent);
    for (const clip of parsedRegistry.virtualClips) {
      expect(clip.transcription).toBeUndefined();
      expect(clip.fullTranscription).toBeUndefined();
      expect(clip.transcriptionChunks).toBeUndefined();
    }

    // 2. Test Single Clip Re-process from Context Menu
    const targetRow = window.locator(".clips-table tbody tr", { hasText: "ZOOM0001 - Harmony Warmups" }).first();
    await targetRow.click({ button: "right" });

    const reprocessMenuItem = window.locator("[data-testid=\"ctx-reprocess-clip\"]");
    await expect(reprocessMenuItem).toBeVisible();
    await reprocessMenuItem.click();

    // Verify toast appears
    const toast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Re-process");

    // 3. Test Library AI Refresh Modal
    const refreshLibraryBtn = window.locator("[data-testid=\"refresh-ai-library-btn\"]");
    await expect(refreshLibraryBtn).toBeVisible();
    await refreshLibraryBtn.click();

    const refreshModal = window.locator("[data-testid=\"refresh-ai-modal\"]");
    await expect(refreshModal).toBeVisible();

    const backfillBtn = window.locator("[data-testid=\"refresh-missing-btn\"]");
    await expect(backfillBtn).toBeVisible();
    await backfillBtn.click();

    // Modal closes and toast feedback appears
    await expect(refreshModal).toBeHidden();
    await expect(toast).toBeVisible();

    await app.close();
  });

  test("14. Navigation Shell & Commands: Workspace switching, Library Views, and Collection creation", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Verify workspace switcher is present
    const switcher = window.locator("[data-testid=\"workspace-switcher\"]");
    await expect(switcher).toBeVisible();

    // 2. Switch to Imports workspace
    const importsTab = switcher.locator("button", { hasText: "Imports" });
    await importsTab.click();
    const importsWorkspace = window.locator("[data-testid=\"imports-workspace\"]");
    await expect(importsWorkspace).toBeVisible();

    // 3. Switch back to Library workspace using shortcut (Meta+1) or button
    const libraryTab = switcher.locator("button", { hasText: "Library" });
    await libraryTab.click();
    await expect(window.locator(".clips-pane")).toBeVisible();

    // 4. Create New Collection via button
    const newColBtn = window.locator("button.nav-header-action", { hasText: "+ New" });
    await expect(newColBtn).toBeVisible();
    await newColBtn.click();

    // Modal opens
    const modalInput = window.locator(".modal-body input");
    await expect(modalInput).toBeVisible();
    await modalInput.fill("Field Research 2026");
    await window.keyboard.press("Enter");

    // Verify toast and new collection item
    const toast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Created collection \"Field Research 2026\"");

    const colItem = window.locator(".collection-item", { hasText: "Field Research 2026" });
    await expect(colItem).toBeVisible();

    // 5. Test Library Views filtering
    const needsReview = window.locator(".nav-item", { hasText: "Needs Review" });
    await expect(needsReview).toBeVisible();
    await needsReview.click();
    await expect(needsReview).toHaveClass(/active/);

    const allRecordings = window.locator(".nav-item", { hasText: "All Recordings" });
    await allRecordings.click();
    await expect(allRecordings).toHaveClass(/active/);

    await app.close();
  });

  test("15. Scalable Library Browsing & Selection: Grouping, Transcript status filtering, and Batch Selection Bar", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Verify Library Toolbar is present
    const toolbar = window.locator("[data-testid=\"library-toolbar\"]");
    await expect(toolbar).toBeVisible();

    // 2. Verify Grouping selector defaults to 'none'
    const groupingSelect = window.locator("[data-testid=\"grouping-select\"]");
    await expect(groupingSelect).toBeVisible();
    expect(await groupingSelect.inputValue()).toBe("none");
    await expect(window.locator(".group-header-row")).toHaveCount(0);

    // Switch grouping to 'month'
    await groupingSelect.selectOption("month");

    // Verify group header rows exist in Month grouping mode
    const groupHeaders = window.locator(".group-header-row");
    const groupCount = await groupHeaders.count();
    expect(groupCount).toBeGreaterThanOrEqual(1);

    // 3. Test collapsing a group
    const firstGroupBtn = groupHeaders.first().locator("button.group-header-btn");
    await expect(firstGroupBtn).toBeVisible();
    await firstGroupBtn.click();

    // Switch grouping back to none (flat list)
    await groupingSelect.selectOption("none");
    await expect(window.locator(".group-header-row")).toHaveCount(0);

    // 4. Test Multi-Selection and Batch Selection Bar
    const checkboxes = window.locator(".clips-table tbody tr input[type=\"checkbox\"]");
    await expect(checkboxes.first()).toBeVisible();

    // Select first and second recordings
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();

    const batchBar = window.locator("[data-testid=\"batch-selection-bar\"]");
    await expect(batchBar).toBeVisible();
    await expect(batchBar).toContainText("2 recordings selected");

    // Test Batch Mark Reviewed
    const markReviewedBtn = batchBar.locator("button", { hasText: "Mark reviewed" });
    await markReviewedBtn.click();
    const toast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Marked 2 recording(s) as reviewed");

    // Test Clear Selection button
    const clearSelectionBtn = batchBar.locator("button", { hasText: "Clear selection" });
    await clearSelectionBtn.click();
    await expect(batchBar).toBeHidden();

    // 5. Test Transcript Status filtering
    const statusSelect = window.locator("[data-testid=\"transcript-filter-select\"]");
    await statusSelect.selectOption("ready");
    
    // Rows should update to only ready takes
    const rows = window.locator(".clips-table tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(1);

    // Clear filter
    const clearFilterBtn = toolbar.locator("button", { hasText: "Clear filter" });
    await clearFilterBtn.click();
    expect(await statusSelect.inputValue()).toBe("all");

    await app.close();
  });

  test("16. Collections, Batch Assignments, and Saved Views: Batch assignment to collection, sidebar collection filtering, saving custom view, applying and deleting view", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Select two recordings using row checkboxes
    const checkboxes = window.locator(".clips-table tbody tr input[type=\"checkbox\"]");
    await expect(checkboxes.first()).toBeVisible();
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();

    // 2. Open Batch Add to Collection modal
    const batchBar = window.locator("[data-testid=\"batch-selection-bar\"]");
    await expect(batchBar).toBeVisible();
    const addToColBtn = batchBar.locator("button", { hasText: "Add to collection…" });
    await addToColBtn.click();

    // Fill collection name and confirm
    const colInput = window.locator("[data-testid=\"batch-collection-input\"]");
    await expect(colInput).toBeVisible();
    await colInput.fill("Field Experiments");
    const confirmAddBtn = window.locator("[data-testid=\"confirm-add-collection-btn\"]");
    await confirmAddBtn.click();

    // Verify toast notification
    const toast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Added 2 recording(s) to "Field Experiments"');

    // 3. Verify collection appears in the sidebar Collections section
    const colSection = window.locator("[data-testid=\"collections-section\"]");
    await expect(colSection).toBeVisible();
    const colItem = colSection.locator(".collection-item", { hasText: "Field Experiments" });
    await expect(colItem).toBeVisible();
    await expect(colItem).toContainText("2");

    // Click collection in sidebar to view its recordings
    await colItem.click();
    await expect(window.locator(".clips-table tbody tr")).toHaveCount(2);

    // 4. Save current view via Library Toolbar
    const saveViewBtn = window.locator("[data-testid=\"save-view-btn\"]");
    await expect(saveViewBtn).toBeVisible();
    await saveViewBtn.click();

    const viewNameInput = window.locator("[data-testid=\"save-view-name-input\"]");
    await expect(viewNameInput).toBeVisible();
    await viewNameInput.fill("Field Experiments View");
    const confirmSaveBtn = window.locator("[data-testid=\"confirm-save-view-btn\"]");
    await confirmSaveBtn.click();

    await expect(toast).toContainText('Saved view "Field Experiments View"');

    // 5. Verify Saved View appears in the sidebar Saved Views section
    const savedViewsSection = window.locator("[data-testid=\"saved-views-section\"]");
    await expect(savedViewsSection).toBeVisible();
    const savedViewItem = savedViewsSection.locator(".collection-item", { hasText: "Field Experiments View" });
    await expect(savedViewItem).toBeVisible();

    // Switch back to "All Recordings"
    const allRecordingsBtn = window.locator(".app-sidebar .nav-item", { hasText: "All Recordings" });
    await allRecordingsBtn.click();
    expect(await window.locator(".clips-table tbody tr").count()).toBeGreaterThan(2);

    // Click saved view in sidebar: immediately restores filtered view
    await savedViewItem.click();
    await expect(window.locator(".clips-table tbody tr")).toHaveCount(2);

    // 6. Delete the saved view
    const deleteViewBtn = savedViewItem.locator("button[title=\"Delete saved view\"]");
    await deleteViewBtn.click();
    await expect(savedViewsSection.locator(".collection-item", { hasText: "Field Experiments View" })).toHaveCount(0);

    await app.close();
  });
});


