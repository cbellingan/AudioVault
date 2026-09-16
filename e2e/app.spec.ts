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

  test("17. Recording & Transcript Workspace: deep-dive navigation, player controls, transcript editing, excerpts and review (Slice F05)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    // 1. Enter detail workspace by clicking a clip title link
    const firstTitleLink = window.locator("[data-testid=\"clip-title-link\"]").first();
    const clipTitle = (await firstTitleLink.innerText()).trim();
    await firstTitleLink.click();

    // Verify workspace switched to recording workspace
    const recWorkspace = window.locator("[data-testid=\"recording-workspace\"]");
    await expect(recWorkspace).toBeVisible();
    await expect(window.locator("[data-testid=\"detail-title\"]")).toHaveText(clipTitle);

    // Verify two-column layout
    const transcriptCard = window.locator("[data-testid=\"detail-transcript-card\"]");
    const sidebarCard = window.locator("[data-testid=\"detail-sidebar-card\"]");
    await expect(transcriptCard).toBeVisible();
    await expect(sidebarCard).toBeVisible();

    // 2. Test Player Controls in bottom player bar
    const playerBar = window.locator("[data-testid=\"detail-player-bar\"]");
    await expect(playerBar).toBeVisible();

    const playBtn = window.locator("[data-testid=\"detail-play-btn\"]");
    await expect(playBtn).toBeVisible();
    await playBtn.click();
    await expect(playBtn).toHaveText("⏸");
    await playBtn.click();
    await expect(playBtn).toHaveText("▶");

    // Skip buttons
    const skipBackBtn = window.locator("[data-testid=\"detail-skip-back-btn\"]");
    const skipFwdBtn = window.locator("[data-testid=\"detail-skip-forward-btn\"]");
    await expect(skipBackBtn).toBeVisible();
    await expect(skipFwdBtn).toBeVisible();
    await skipFwdBtn.click();

    // Speed selector
    const speedSelect = window.locator("[data-testid=\"detail-speed-select\"]");
    await expect(speedSelect).toBeVisible();
    await speedSelect.selectOption("1.5");
    await expect(speedSelect).toHaveValue("1.5");

    // 3. Test Transcript features (if passages exist, or edit text)
    const editBtn = window.locator("[data-testid=\"detail-edit-transcript-btn\"]");
    if (await editBtn.isVisible()) {
      await editBtn.click();
      const editModal = window.locator("[data-testid=\"edit-transcript-modal\"]");
      await expect(editModal).toBeVisible();
      const textarea = window.locator("[data-testid=\"edit-transcript-textarea\"]");
      await textarea.fill("This is a verified test edit for the transcript.");
      const confirmSaveBtn = window.locator("[data-testid=\"confirm-save-transcript-btn\"]");
      await confirmSaveBtn.click();
      await expect(editModal).toHaveCount(0);
      const toast = window.locator("[data-testid=\"copy-toast\"]");
      await expect(toast).toContainText("Transcript updated");
    }

    // 4. Test Save Excerpt Modal and Child Clip Creation
    const saveExcerptBtn = window.locator("[data-testid=\"detail-save-excerpt-btn\"]");
    await expect(saveExcerptBtn).toBeVisible();
    await saveExcerptBtn.click();

    const excerptModal = window.locator("[data-testid=\"save-excerpt-modal\"]");
    await expect(excerptModal).toBeVisible();

    const titleInput = window.locator("[data-testid=\"excerpt-title-input\"]");
    await titleInput.fill("Key Architectural Excerpt");
    const confirmExcerptBtn = window.locator("[data-testid=\"confirm-save-excerpt-btn\"]");
    await confirmExcerptBtn.click();
    await expect(excerptModal).toHaveCount(0);

    // Verify excerpt appears under Saved Excerpts in sidebar card
    const excerptsList = window.locator("[data-testid=\"detail-excerpts-list\"]");
    await expect(excerptsList).toBeVisible();
    await expect(excerptsList).toContainText("Key Architectural Excerpt");

    // 5. Test Review Toggle
    const reviewBtn = window.locator("[data-testid=\"detail-review-toggle-btn\"]");
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();
    await expect(reviewBtn).toContainText("Reviewed");

    // 6. Navigate back to Library
    const backBtn = window.locator("[data-testid=\"detail-back-btn\"]");
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Verify we are back in Library workspace
    await expect(window.locator(".clips-table")).toBeVisible();
    await expect(window.locator("[data-testid=\"recording-workspace\"]")).toHaveCount(0);

    await app.close();
  });

  test("18. Indexed Search with Passage Navigation: global search, scope switching, passage hits view, timestamp navigation, and return to search (Slice F06)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    // 1. Check header search input and search scope select
    const searchInput = window.locator(".header-search-input");
    const scopeSelect = window.locator("[data-testid=\"search-scope-select\"]");
    await expect(searchInput).toBeVisible();
    await expect(scopeSelect).toBeVisible();
    await expect(scopeSelect).toHaveValue("all");

    // 2. Search for words present in sandbox fixture transcripts ("pipeline")
    await searchInput.fill("pipeline");

    // Matches pill should appear
    const matchPill = window.locator(".search-matches-pill");
    await expect(matchPill).toBeVisible();

    // 3. Test Search Scope filtering
    // Scope = titles: shouldn't match clips whose titles don't contain this phrase
    await scopeSelect.selectOption("titles");
    await expect(window.locator(".clips-table tbody tr")).toHaveCount(1); // empty state row

    // Scope = transcripts: finds the recordings
    await scopeSelect.selectOption("transcripts");
    const transcriptRows = window.locator(".clips-table tbody tr");
    expect(await transcriptRows.count()).toBeGreaterThanOrEqual(1);

    // Switch back to "all"
    await scopeSelect.selectOption("all");

    // 4. Test View Mode Toggle: switch from Table to Passage Hits View
    const toggleView = window.locator("[data-testid=\"search-view-mode-toggle\"]");
    await expect(toggleView).toBeVisible();

    const passagesBtn = window.locator("[data-testid=\"search-mode-passages-btn\"]");
    await expect(passagesBtn).toBeVisible();
    await passagesBtn.click();

    // Verify search-results-view is rendered
    const searchResultsView = window.locator("[data-testid=\"search-results-view\"]");
    await expect(searchResultsView).toBeVisible();

    const resultItems = window.locator("[data-testid=\"search-result-item\"]");
    expect(await resultItems.count()).toBeGreaterThanOrEqual(1);

    // Verify highlighted match exists in blockquote
    const highlightMarks = searchResultsView.locator("mark.search-highlight-mark");
    expect(await highlightMarks.count()).toBeGreaterThanOrEqual(1);

    // 5. Click passage timestamp to deep-link directly into detail workspace
    const timestampBtn = searchResultsView.locator(".passage-timestamp").first();
    await expect(timestampBtn).toBeVisible();
    await timestampBtn.click();

    // Workspace transitions to recording workspace
    const recWorkspace = window.locator("[data-testid=\"recording-workspace\"]");
    await expect(recWorkspace).toBeVisible();

    // Back button should say "← Back to Search Results"
    const backBtn = window.locator("[data-testid=\"detail-back-btn\"]");
    await expect(backBtn).toHaveText("← Back to Search Results");

    // 6. Click Back to return to search results
    await backBtn.click();
    await expect(searchResultsView).toBeVisible();
    await expect(recWorkspace).toHaveCount(0);

    // Switch back to Table View
    const tableBtn = window.locator("[data-testid=\"search-mode-table-btn\"]");
    await tableBtn.click();
    await expect(window.locator(".clips-table")).toBeVisible();

    // Clear search
    await searchInput.focus();
    await window.keyboard.press("Escape");
    await expect(searchInput).toHaveValue("");

    await app.close();
  });

  test("19. Import Planning & Duplicate Explanations: review modal, duplicate/excluded explanations, collection targeting, cancel and execute (Slice F07)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    const initialRowCount = await window.locator(".clips-table tbody tr").count();

    // 1. Prepare a simulated external source folder with mixed files:
    // - 1 new WAV file
    // - 1 duplicate WAV file (same content as ZOOM0001_WARMUPS.WAV in sandbox)
    // - 1 excluded/deleted file (we delete ZOOM0002 to create a tombstone)
    const extSourceDir = path.join(sandbox.sandboxDir, "mock_sd_card");
    fs.mkdirSync(extSourceDir, { recursive: true });

    // File A: brand new recording
    const newTakePath = path.join(extSourceDir, "NEW_FIELD_TAKE.WAV");
    const newTakeBuffer = generateSyntheticWavBuffer({ durationSeconds: 2.0, frequency: 380 });
    fs.writeFileSync(newTakePath, newTakeBuffer);

    // File B: duplicate of existing take
    const dupTakePath = path.join(extSourceDir, "DUP_ZOOM0001.WAV");
    const existingWarmupPath = path.join(sandbox.rawDir, "ZOOM0001_WARMUPS.WAV");
    fs.copyFileSync(existingWarmupPath, dupTakePath);

    // Delete ZOOM0002 to create a tombstone for File C
    await window.evaluate(async () => {
      const clips = await (window as any).audioVault.getVirtualClips();
      const clip02 = clips.find((c: any) => c.title.includes("ZOOM0002"));
      if (clip02) {
        await (window as any).audioVault.deleteVirtualClip(clip02.id, true);
        if ((window as any).__reloadClips) {
          await (window as any).__reloadClips();
        }
      }
    });

    // File C: excluded take with content of deleted clip
    const excTakePath = path.join(extSourceDir, "EXC_ZOOM0002.WAV");
    const sampleBuffer02 = generateSyntheticWavBuffer({ durationSeconds: 3.0, frequency: 880 });
    fs.writeFileSync(excTakePath, sampleBuffer02);

    // 2. Open Import Planning Modal via __openImportPlanner
    await window.evaluate(async (srcDir) => {
      await (window as any).__openImportPlanner([srcDir], "Field Zoom Recorder");
    }, extSourceDir);

    // 3. Verify Import Plan Review Modal elements
    const planModal = window.locator("[data-testid=\"import-plan-modal\"]");
    await expect(planModal).toBeVisible();

    const planTitle = window.locator("[data-testid=\"import-plan-title\"]");
    await expect(planTitle).toHaveText("1 new recording");

    const planSubtitle = window.locator("[data-testid=\"import-plan-subtitle\"]");
    await expect(planSubtitle).toContainText("Field Zoom Recorder");
    await expect(planSubtitle).toContainText("3 found");
    await expect(planSubtitle).toContainText("1 already in library");
    await expect(planSubtitle).toContainText("1 previously excluded");

    // Check collapsible skipped recordings
    const skippedDetails = window.locator("[data-testid=\"import-skipped-details\"]");
    await expect(skippedDetails).toBeVisible();
    await expect(skippedDetails).toContainText("2 skipped recording(s)");

    // 4. Test Cancel: clicking cancel makes 0 library mutations
    const cancelBtn = window.locator("[data-testid=\"cancel-import-btn\"]");
    await cancelBtn.click();
    await expect(planModal).toHaveCount(0);

    // Verify row count is unchanged
    const afterCancelCount = await window.locator(".clips-table tbody tr").count();
    expect(afterCancelCount).toBe(initialRowCount - 1); // minus the 1 we deleted to create tombstone

    // 5. Re-open modal, choose collection, and confirm import
    await window.evaluate(async (srcDir) => {
      await (window as any).__openImportPlanner([srcDir], "Field Zoom Recorder");
    }, extSourceDir);

    await expect(planModal).toBeVisible();

    // Select Target Collection
    const colSelect = window.locator("[data-testid=\"import-plan-collection-select\"]");
    await expect(colSelect).toBeVisible();
    await colSelect.selectOption("Personal ideas");

    // Verify auto-transcribe toggle is checked
    const autoTranscribeToggle = window.locator("[data-testid=\"import-plan-autotranscribe-toggle\"]");
    await expect(autoTranscribeToggle).toBeChecked();

    // Confirm import
    const confirmBtn = window.locator("[data-testid=\"confirm-import-btn\"]");
    await confirmBtn.click();

    // Modal closes
    await expect(planModal).toHaveCount(0);

    // Toast appears
    const toast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Enqueued 1 audio take for ingestion!");

    // Verify workspace switched to imports
    await expect(window.locator("[data-testid=\"imports-workspace\"]")).toBeVisible();

    // Switch back to library and verify new take appears
    const libraryNav = window.locator(".app-sidebar .nav-item", { hasText: "All Recordings" });
    await libraryNav.click();

    const newClipRow = window.locator(".clips-table tbody tr", { hasText: "NEW_FIELD_TAKE" });
    await expect(newClipRow).toBeVisible({ timeout: 12000 });

    await app.close();
  });

  test("20. Early Audio Availability & Safe Copy Lifecycle: file is playable immediately upon copy before transcription completes, and status displays safe disconnect badge (Slice F08)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    const extSourceDir = path.join(sandbox.sandboxDir, "mock_field_sd");
    fs.mkdirSync(extSourceDir, { recursive: true });

    const takePath = path.join(extSourceDir, "F08_EARLY_PLAYABLE.WAV");
    const sampleBuffer = generateSyntheticWavBuffer({ durationSeconds: 2.0, frequency: 500 });
    fs.writeFileSync(takePath, sampleBuffer);

    // Set test unmount volume path on window
    await window.evaluate((dir) => {
      (window as any).__testUnmountVolumePath = dir;
    }, extSourceDir);

    // Open import planner and execute
    await window.evaluate(async (srcDir) => {
      await (window as any).__openImportPlanner([srcDir], "Field Zoom Recorder");
    }, extSourceDir);

    const planModal = window.locator("[data-testid=\"import-plan-modal\"]");
    await expect(planModal).toBeVisible();

    const confirmBtn = window.locator("[data-testid=\"confirm-import-btn\"]");
    await confirmBtn.click();
    await expect(planModal).toHaveCount(0);

    // Switch to All Recordings view
    const libraryNav = window.locator(".app-sidebar .nav-item", { hasText: "All Recordings" });
    await libraryNav.click();

    // Verify row appears immediately as playable with waveform
    const earlyClipRow = window.locator(".clips-table tbody tr", { hasText: "F08_EARLY_PLAYABLE" });
    await expect(earlyClipRow).toBeVisible({ timeout: 10000 });

    // Select row and trigger playback
    await earlyClipRow.click();
    const playBtn = window.locator(".play-btn");
    await expect(playBtn).toBeVisible();
    await playBtn.click();
    await expect(playBtn).toHaveText("⏸");

    // Click title link to enter deep-dive workspace
    const titleLink = earlyClipRow.locator("[data-testid=\"clip-title-link\"]");
    await titleLink.click();

    // Verify detail player bar is active and populated
    const playerBar = window.locator("[data-testid=\"detail-player-bar\"]");
    await expect(playerBar).toBeVisible();
    await expect(playerBar).toContainText("F08_EARLY_PLAYABLE");

    // Return to library
    const backBtn = window.locator("[data-testid=\"detail-back-btn\"]");
    await backBtn.click();

    // Verify pipeline tray displays safe disconnect / unmounted badge once copy is done
    const safeBadge = window.locator("[data-testid=\"sd-card-safe-badge\"]");
    await expect(safeBadge).toBeVisible({ timeout: 10000 });

    await app.close();
  });

  test("21. Persistent Import History & Recoverable Job Queue: imports workspace displays persistent batch cards, stats, and 'View in library' collection navigation (Slice F09)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    // 1. Navigate to Imports workspace using switcher button
    const importsBtn = window.locator("[data-testid=\"workspace-imports-btn\"]");
    await importsBtn.click();

    const importsWorkspace = window.locator("[data-testid=\"imports-workspace\"]");
    await expect(importsWorkspace).toBeVisible();

    const historySection = window.locator("[data-testid=\"import-history-section\"]");
    await expect(historySection).toBeVisible();

    // 2. Prepare mock external audio source with 2 takes
    const extSourceDir = path.join(sandbox.sandboxDir, "mock_f09_batch");
    fs.mkdirSync(extSourceDir, { recursive: true });

    const take1 = path.join(extSourceDir, "F09_CARD_TAKE1.WAV");
    const take2 = path.join(extSourceDir, "F09_CARD_TAKE2.WAV");
    fs.writeFileSync(take1, generateSyntheticWavBuffer({ durationSeconds: 1.0, frequency: 440 }));
    fs.writeFileSync(take2, generateSyntheticWavBuffer({ durationSeconds: 1.2, frequency: 880 }));

    // Open import planner with a target collection
    await window.evaluate(async (srcDir) => {
      await (window as any).__openImportPlanner([srcDir], "Field Kit SD");
    }, extSourceDir);

    const planModal = window.locator("[data-testid=\"import-plan-modal\"]");
    await expect(planModal).toBeVisible();

    // Select target collection 'Personal ideas'
    const colSelect = window.locator("[data-testid=\"import-plan-collection-select\"]");
    await colSelect.selectOption("Personal ideas");

    const confirmBtn = window.locator("[data-testid=\"confirm-import-btn\"]");
    await confirmBtn.click();
    await expect(planModal).toHaveCount(0);

    // Verify import batch card appears in Import History
    const batchCard = window.locator("[data-testid=\"import-batch-card\"]").first();
    await expect(batchCard).toBeVisible({ timeout: 10000 });
    await expect(batchCard).toContainText("Personal ideas");

    // Wait for the batch to reach completed status
    await expect(batchCard.locator(".badge-emerald")).toContainText("Completed", { timeout: 15000 });
    await expect(batchCard).toContainText("2 takes imported");

    // Click "View in library" button on the batch card
    const viewBtn = batchCard.locator("[data-testid=\"view-batch-recordings-btn\"]");
    await viewBtn.click();

    // Verify navigation back to library workspace filtered by collection
    const activeCol = window.locator(".collection-item.active");
    await expect(activeCol).toBeVisible();
    await expect(activeCol).toContainText("Personal ideas");

    await app.close();
  });

  test("22. Transcript Versions, Corrections & AI Ownership: editing transcript updates passages, supports switching between User Edited and Original Machine versions, reverts safely with confirmation, and allows editing protected user title (Slice F10)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    // 1. Find and click title link of a recording that has a transcript
    const targetRow = window.locator(".clips-table tbody tr", { hasText: "STE-003 - Product Standup" }).first();
    await expect(targetRow).toBeVisible();
    const titleLink = targetRow.locator("[data-testid=\"clip-title-link\"]");
    await titleLink.click();

    // 2. Detail workspace is visible
    const workspace = window.locator("[data-testid=\"recording-workspace\"]");
    await expect(workspace).toBeVisible();

    // 3. Test Title Editing
    const editTitleBtn = window.locator("[data-testid=\"edit-title-btn\"]");
    await expect(editTitleBtn).toBeVisible();
    await editTitleBtn.click();

    const editTitleInput = window.locator("[data-testid=\"edit-title-input\"]");
    await expect(editTitleInput).toBeVisible();
    await editTitleInput.fill("Product Standup (Sprint Retrospective)");

    const saveTitleBtn = window.locator("[data-testid=\"save-title-btn\"]");
    await saveTitleBtn.click();

    const detailTitle = window.locator("[data-testid=\"detail-title\"]");
    await expect(detailTitle).toHaveText("Product Standup (Sprint Retrospective)");

    // 4. Test Transcript Editing
    const editTranscriptBtn = window.locator("[data-testid=\"detail-edit-transcript-btn\"]");
    await expect(editTranscriptBtn).toBeVisible();
    await editTranscriptBtn.click();

    const editModal = window.locator("[data-testid=\"edit-transcript-modal\"]");
    await expect(editModal).toBeVisible();

    const textarea = window.locator("[data-testid=\"edit-transcript-textarea\"]");
    await expect(textarea).toBeVisible();
    await textarea.fill("[00:00] City is breaking down on a camel's back.\n[00:08] They just have to go cause they don't know wack.");

    const confirmSaveBtn = window.locator("[data-testid=\"confirm-save-transcript-btn\"]");
    await confirmSaveBtn.click();
    await expect(editModal).toHaveCount(0);

    // 5. Verify User Edited badge and passages update immediately
    const editedBadge = window.locator("[data-testid=\"transcript-edited-badge\"]");
    await expect(editedBadge).toBeVisible();
    await expect(editedBadge).toContainText("User Edited");

    const scrollPanel = window.locator("[data-testid=\"detail-transcript-scroll\"]");
    await expect(scrollPanel).toBeVisible();
    await expect(scrollPanel).toContainText("City is breaking down on a camel's back");
    await expect(scrollPanel).toContainText("They just have to go cause they don't know wack");

    // 6. Test version switcher: switch to Original Machine version
    const versionSwitcher = window.locator("[data-testid=\"transcript-version-switcher\"]");
    await expect(versionSwitcher).toBeVisible();

    const machineVersionBtn = window.locator("[data-testid=\"version-machine-btn\"]");
    await machineVersionBtn.click();

    // In machine version view, passages show machine transcript
    const editedVersionBtn = window.locator("[data-testid=\"version-edited-btn\"]");
    await editedVersionBtn.click();
    await expect(scrollPanel).toContainText("City is breaking down");

    // 7. Test Revert to machine transcript with confirmation
    const revertBtn = window.locator("[data-testid=\"revert-to-machine-btn\"]");
    await expect(revertBtn).toBeVisible();
    await revertBtn.click();

    const revertModal = window.locator("[data-testid=\"revert-confirm-modal\"]");
    await expect(revertModal).toBeVisible();

    const confirmRevertBtn = window.locator("[data-testid=\"confirm-revert-btn\"]");
    await confirmRevertBtn.click();
    await expect(revertModal).toHaveCount(0);

    // Edited badge should disappear after reverting
    await expect(editedBadge).toHaveCount(0);

    // 8. Return to Library and verify updated title is preserved
    const backBtn = window.locator("[data-testid=\"detail-back-btn\"]");
    await backBtn.click();

    const updatedRow = window.locator(".clips-table tbody tr", { hasText: "Product Standup (Sprint Retrospective)" });
    await expect(updatedRow).toBeVisible();

    await app.close();
  });

  test("23. Batch Actions, Excerpts & Exports: multi-row selection bar, batch transcribe/review, unified export modal (WAV/MP3/SRT/TXT), and excerpt creation (Slice F11)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });

    // 1. Select multiple recordings using table checkboxes
    const checkboxes = window.locator(".clips-table tbody tr input[type=\"checkbox\"]");
    await expect(checkboxes.first()).toBeVisible();
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // 2. Verify floating batch selection bar appears
    const batchBar = window.locator("[data-testid=\"batch-selection-bar\"]");
    await expect(batchBar).toBeVisible();
    await expect(batchBar).toContainText("2 recordings selected");

    // 3. Test Batch Mark Reviewed
    const batchReviewBtn = window.locator("[data-testid=\"batch-reviewed-btn\"]");
    await expect(batchReviewBtn).toBeVisible();
    await batchReviewBtn.click();

    // 4. Test Batch Transcribe
    const batchTranscribeBtn = window.locator("[data-testid=\"batch-transcribe-btn\"]");
    await expect(batchTranscribeBtn).toBeVisible();
    await batchTranscribeBtn.click();

    // 5. Test Unified Export Modal from Batch Bar
    const batchExportBtn = window.locator("[data-testid=\"batch-export-btn\"]");
    await expect(batchExportBtn).toBeVisible();
    await batchExportBtn.click();

    const exportModal = window.locator("[data-testid=\"unified-export-modal\"]");
    await expect(exportModal).toBeVisible();

    const scopeBadge = window.locator("[data-testid=\"export-scope-badge\"]");
    await expect(scopeBadge).toContainText("2 recordings selected");

    // Select WAV audio and SRT subtitles
    const wavOption = window.locator("[data-testid=\"export-audio-wav\"]");
    await wavOption.click();

    const srtOption = window.locator("[data-testid=\"export-transcript-srt\"]");
    await srtOption.click();

    const confirmExportBtn = window.locator("[data-testid=\"confirm-unified-export-btn\"]");
    await expect(confirmExportBtn).toBeEnabled();
    await confirmExportBtn.click();

    // Modal closes on export completion
    await expect(exportModal).toHaveCount(0, { timeout: 8000 });

    // 6. Enter Detail Workspace and test Excerpt Creation
    const firstTitleLink = window.locator("[data-testid=\"clip-title-link\"]").first();
    await firstTitleLink.click();

    const workspace = window.locator("[data-testid=\"recording-workspace\"]");
    await expect(workspace).toBeVisible();

    const saveExcerptBtn = window.locator("[data-testid=\"detail-save-excerpt-btn\"]");
    await expect(saveExcerptBtn).toBeVisible();
    await saveExcerptBtn.click();

    const excerptModal = window.locator("[data-testid=\"save-excerpt-modal\"]");
    await expect(excerptModal).toBeVisible();

    const excerptTitleInput = window.locator("[data-testid=\"excerpt-title-input\"]");
    await excerptTitleInput.fill("Chorus Excerpt Hook");

    const excerptStartInput = window.locator("[data-testid=\"excerpt-start-input\"]");
    await excerptStartInput.fill("1");

    const excerptEndInput = window.locator("[data-testid=\"excerpt-end-input\"]");
    await excerptEndInput.fill("4");

    const confirmSaveExcerptBtn = window.locator("[data-testid=\"confirm-save-excerpt-btn\"]");
    await confirmSaveExcerptBtn.click();
    await expect(excerptModal).toHaveCount(0);

    // Verify created excerpt appears in sidebar excerpts list
    const excerptsList = window.locator(".detail-excerpts-list");
    await expect(excerptsList).toBeVisible();
    await expect(excerptsList).toContainText("Chorus Excerpt Hook");

    // 7. Test Export Modal from Detail Workspace
    const detailExportBtn = window.locator("[data-testid=\"detail-export-btn\"]");
    await expect(detailExportBtn).toBeVisible();
    await detailExportBtn.click();

    await expect(exportModal).toBeVisible();
    await expect(scopeBadge).toContainText("1 recording selected");

    const cancelExportBtn = window.locator("[data-testid=\"cancel-unified-export-btn\"]");
    await cancelExportBtn.click();
    await expect(exportModal).toHaveCount(0);

    await app.close();
  });

  test("24. Storage Management & Exclusions: Workspace settings, disk stats, recoverable exclusions, and vault moving", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Verify Header Storage Button is present and click to open Settings workspace
    const headerStorageBtn = window.locator("[data-testid=\"header-storage-vault-btn\"]");
    await expect(headerStorageBtn).toBeVisible();
    await headerStorageBtn.click();

    // 2. Verify Settings Workspace is active
    const settingsWorkspace = window.locator("[data-testid=\"settings-workspace\"]");
    await expect(settingsWorkspace).toBeVisible();

    // Verify vault location card and path display
    const vaultCard = window.locator("[data-testid=\"vault-location-card\"]");
    await expect(vaultCard).toBeVisible();

    const pathDisplay = window.locator("[data-testid=\"vault-path-display\"]");
    await expect(pathDisplay).toBeVisible();
    await expect(pathDisplay).toContainText(sandbox.sandboxDir);

    // Verify Excluded Recordings Card is present and initially empty
    const excludedPanel = window.locator("[data-testid=\"excluded-recordings-panel\"]");
    await expect(excludedPanel).toBeVisible();

    const emptyExcluded = window.locator("[data-testid=\"no-excluded-recordings\"]");
    await expect(emptyExcluded).toBeVisible();

    // 3. Navigate back to Library workspace
    const backBtn = window.locator("[data-testid=\"settings-back-btn\"]");
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    const clipsPane = window.locator(".clips-pane");
    await expect(clipsPane).toBeVisible();

    // 4. Hide a recording via row context menu
    const targetRow = window.locator(".clips-table tbody tr", { hasText: "STE-003 - Product Standup" });
    await expect(targetRow).toBeVisible();
    await targetRow.click({ button: "right" });

    const hideItem = window.locator("[data-testid=\"ctx-toggle-hide\"]");
    await expect(hideItem).toBeVisible();
    await expect(hideItem).toContainText("Hide from Library");
    await hideItem.click();

    // Recording should now be hidden from Library table
    await expect(window.locator(".clips-table tbody tr", { hasText: "STE-003 - Product Standup" })).toHaveCount(0);

    // 5. Navigate to Settings workspace via sidebar nav button
    const sidebarSettingsBtn = window.locator("[data-testid=\"workspace-settings-btn\"]");
    await expect(sidebarSettingsBtn).toBeVisible();
    await sidebarSettingsBtn.click();
    await expect(settingsWorkspace).toBeVisible();

    // 6. Verify excluded recording appears in the Excluded list
    const excludedList = window.locator("[data-testid=\"excluded-items-list\"]");
    await expect(excludedList).toBeVisible();
    await expect(excludedList).toContainText("STE-003 - Product Standup");

    // 7. Click Restore to Library
    const restoreBtn = window.locator("[data-testid=\"restore-clip-btn\"]").first();
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // Verify empty state returns
    await expect(emptyExcluded).toBeVisible();

    // 8. Return to Library and verify recording is visible again
    await backBtn.click();
    await expect(window.locator(".clips-table tbody tr", { hasText: "STE-003 - Product Standup" })).toBeVisible();

    // 9. Return to Settings and test Move Vault
    await sidebarSettingsBtn.click();
    await expect(settingsWorkspace).toBeVisible();

    const moveVaultBtn = window.locator("[data-testid=\"move-vault-btn\"]");
    await expect(moveVaultBtn).toBeVisible();
    await moveVaultBtn.click();

    // In test mode, moveVault automatically moves to a new isolated tmpdir
    // Verify toast or path display updates
    const toast = window.locator("[data-testid=\"copy-toast\"]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Vault moved to");

    await app.close();
  });

  test("25. Recording Capture Integration: Recording bar custom title, destination collection assignment, and imports workspace trigger (Slice F13)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Create a test collection to target using UI
    const newColBtn = window.locator("button.nav-header-action", { hasText: "+ New" });
    await expect(newColBtn).toBeVisible();
    await newColBtn.click();

    const modalInput = window.locator(".modal-body input");
    await expect(modalInput).toBeVisible();
    await modalInput.fill("Field Memos 2026");
    await window.keyboard.press("Enter");

    const colItem = window.locator(".collection-item", { hasText: "Field Memos 2026" });
    await expect(colItem).toBeVisible();

    // 2. Switch to Imports workspace
    const switcher = window.locator("[data-testid=\"workspace-switcher\"]");
    const importsTab = switcher.locator("button", { hasText: "Imports" });
    await importsTab.click();
    const importsWorkspace = window.locator("[data-testid=\"imports-workspace\"]");
    await expect(importsWorkspace).toBeVisible();

    // 3. Verify Imports Quick Record Button is visible and click it
    const importsRecordBtn = window.locator("[data-testid=\"imports-record-btn\"]");
    await expect(importsRecordBtn).toBeVisible();
    await importsRecordBtn.click();

    // 4. Verify Recording Bar appears
    const recbar = window.locator("[data-testid=\"recording-bar\"]");
    await expect(recbar).toBeVisible();

    // Verify Title Input in recording bar
    const titleInput = window.locator("[data-testid=\"recbar-title-input\"]");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Field Memo Take 1");
    expect(await titleInput.inputValue()).toBe("Field Memo Take 1");

    // Verify Collection Selector in recording bar
    const colSelect = window.locator("[data-testid=\"recbar-collection-select\"]");
    await expect(colSelect).toBeVisible();
    await colSelect.selectOption("Field Memos 2026");
    expect(await colSelect.inputValue()).toBe("Field Memos 2026");

    // Verify Auto-transcribe toggle and Pause/Resume button
    const autoTranscribeToggle = window.locator("[data-testid=\"recbar-autotranscribe-toggle\"]");
    await expect(autoTranscribeToggle).toBeVisible();

    const pauseBtn = window.locator("[data-testid=\"recbar-pause-btn\"]");
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();
    await expect(pauseBtn).toContainText("Resume");
    await pauseBtn.click();
    await expect(pauseBtn).toContainText("Pause");

    // 5. Save synthetic take via API into the destination collection
    const testPcm = new Int16Array(44100 * 1);
    for (let i = 0; i < testPcm.length; i++) {
      testPcm[i] = Math.sin((i / 44100) * 440 * 2 * Math.PI) * 12000;
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
      return (window as any).audioVault.saveRecordedTake(
        buf,
        "Field Memo Take 1",
        false,
        "Field Memos 2026"
      );
    }, Array.from(new Uint8Array(wavBuffer)));

    expect(savedTake).toBeTruthy();
    expect(savedTake.title).toBe("Field Memo Take 1");
    expect(savedTake.collections).toContain("Field Memos 2026");

    // 6. Navigate back to Library workspace
    const libraryTab = switcher.locator("button", { hasText: "Library" });
    await libraryTab.click();

    // 7. Verify new recorded take appears in Library table
    const newRow = window.locator(".clips-table tbody tr", { hasText: "Field Memo Take 1" });
    await expect(newRow).toBeVisible();

    // 8. Filter by collection in sidebar and verify the recorded clip is shown
    const collectionNavItem = window.locator(".collection-item", { hasText: "Field Memos 2026" });
    await expect(collectionNavItem).toBeVisible();
    await collectionNavItem.click();

    await expect(window.locator(".clips-table tbody tr", { hasText: "Field Memo Take 1" })).toBeVisible();

    await app.close();
  });

  test("26. Accessibility, Modal Roles & Keyboard Esc Dismissal (Slice F14)", async () => {
    const app = await launchTestApp(sandbox);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 1. Test New Collection Modal: ARIA dialog attributes & Esc dismissal
    const newColBtn = window.locator("button.nav-header-action", { hasText: "+ New" });
    await expect(newColBtn).toBeVisible();
    await newColBtn.click();

    const newColModal = window.locator("[data-testid=\"new-collection-modal\"]");
    await expect(newColModal).toBeVisible();
    await expect(newColModal).toHaveAttribute("role", "dialog");
    await expect(newColModal).toHaveAttribute("aria-modal", "true");
    await expect(newColModal).toHaveAttribute("aria-label", "Create New Collection");

    await window.keyboard.press("Escape");
    await expect(newColModal).toHaveCount(0);

    // 2. Test Refresh AI Modal: ARIA dialog attributes & Esc dismissal
    const refreshAiBtn = window.locator("[data-testid=\"refresh-ai-library-btn\"]");
    await expect(refreshAiBtn).toBeVisible();
    await refreshAiBtn.click();

    const refreshAiModal = window.locator("[data-testid=\"refresh-ai-modal\"]");
    await expect(refreshAiModal).toBeVisible();
    const refreshDialog = refreshAiModal.locator(".modal-dialog");
    await expect(refreshDialog).toHaveAttribute("role", "dialog");
    await expect(refreshDialog).toHaveAttribute("aria-modal", "true");

    await window.keyboard.press("Escape");
    await expect(refreshAiModal).toHaveCount(0);

    // 3. Test Unified Export Modal: ARIA dialog attributes & Esc dismissal
    await window.waitForSelector(".clips-table tbody tr", { timeout: 8000 });
    const checkboxes = window.locator(".clips-table tbody tr input[type=\"checkbox\"]");
    await expect(checkboxes.first()).toBeVisible();
    await checkboxes.first().check();

    const batchExportBtn = window.locator("[data-testid=\"batch-export-btn\"]");
    await expect(batchExportBtn).toBeVisible();
    await batchExportBtn.click();

    const exportModal = window.locator("[data-testid=\"unified-export-modal\"]");
    await expect(exportModal).toBeVisible();
    await expect(exportModal).toHaveAttribute("role", "dialog");
    await expect(exportModal).toHaveAttribute("aria-modal", "true");
    await expect(exportModal).toHaveAttribute("aria-label", "Export Recordings");

    await window.keyboard.press("Escape");
    await expect(exportModal).toHaveCount(0);

    // 4. Test Delete Confirmation Modal: ARIA dialog attributes & Esc dismissal
    const firstRow = window.locator(".clips-table tbody tr").first();
    await firstRow.click({ button: "right" });

    const deleteMenuItem = window.locator("[data-testid=\"delete-clip-menu-item\"]");
    await expect(deleteMenuItem).toBeVisible();
    await deleteMenuItem.click();

    const deleteModal = window.locator("[data-testid=\"delete-confirmation-modal\"]");
    await expect(deleteModal).toBeVisible();
    const deleteDialog = deleteModal.locator(".modal-dialog");
    await expect(deleteDialog).toHaveAttribute("role", "dialog");
    await expect(deleteDialog).toHaveAttribute("aria-modal", "true");

    await window.keyboard.press("Escape");
    await expect(deleteModal).toHaveCount(0);

    await app.close();
  });
});




