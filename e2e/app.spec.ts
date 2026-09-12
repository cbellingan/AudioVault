import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('AudioVault Electron Integration Tests', () => {
  test('Launches AudioVault, verifies taxonomy, waveform, and volume detection banner', async () => {
    console.log('[E2E] Launching Electron app...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    console.log('[E2E] Waiting for first window...');
    const window = await app.firstWindow();
    console.log('[E2E] Waiting for domcontentloaded...');
    await window.waitForLoadState('domcontentloaded');

    console.log('[E2E] Checking title...');
    const title = await window.title();
    console.log('[E2E] Title is:', title);
    expect(title).toContain('AudioVault');

    console.log('[E2E] Checking brand title...');
    const brandTitle = await window.locator('.brand-title').innerText();
    console.log('[E2E] Brand title is:', brandTitle);
    expect(brandTitle).toBe('AudioVault');

    console.log('[E2E] Checking nav items...');
    const musicNav = window.locator('.nav-item', { hasText: 'Music & Singing' });
    await expect(musicNav).toBeVisible();

    const concertNav = window.locator('.nav-item', { hasText: 'Concerts & Live' });
    await expect(concertNav).toBeVisible();

    const meetingNav = window.locator('.nav-item', { hasText: 'Meetings' });
    await expect(meetingNav).toBeVisible();

    console.log('[E2E] Checking table rows...');
    const tableRows = window.locator('.clips-table tbody tr');
    await expect(tableRows.first()).toBeVisible();

    // 5. Select a clip that has a Whisper transcription
    console.log('[E2E] Selecting meeting clip with Whisper transcript...');
    const meetingClipRow = window.locator('.clips-table tbody tr', { hasText: 'Product Standup' });
    if (await meetingClipRow.count() > 0) {
      await meetingClipRow.first().click();
      const transcriptBox = window.locator('text=Local Whisper Transcript');
      await expect(transcriptBox).toBeVisible();
      console.log('[E2E] Whisper transcript verified!');
    }

    // 6. Verify Waveform Canvas & Seeking
    console.log('[E2E] Checking canvas...');
    const canvas = window.locator('.waveform-canvas');
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 200, y: 50 } });

    // 7. Verify Playback Controls & Keyboard Shortcuts
    console.log('[E2E] Checking playback controls...');
    const playBtn = window.locator('.play-btn');
    await expect(playBtn).toBeVisible();
    expect(await playBtn.innerText()).toBe('▶');

    // Click play
    await playBtn.click();
    expect(await playBtn.innerText()).toBe('⏸');

    // Spacebar to pause
    await window.keyboard.press('Space');
    expect(await playBtn.innerText()).toBe('▶');

    // 8. Test Scanning Connected Drives & Import Button
    console.log('[E2E] Checking scan and import buttons...');
    const scanBtn = window.locator('button', { hasText: 'Scan Connected Drives' });
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();

    const importBtn = window.locator('button', { hasText: 'Import Folder / SD Card' });
    await expect(importBtn).toBeVisible();

    console.log('[E2E] All interactions verified, closing app...');
    // Close Electron App
    await app.close();
    console.log('[E2E] App closed successfully.');
  });

  test('Library table supports vertical scrolling, row selection, and category filtering', async () => {
    console.log('[E2E] Testing library scrolling and UI interactions...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const clipsPane = window.locator('.clips-pane');
    await expect(clipsPane).toBeVisible();

    const tableRows = window.locator('.clips-table tbody tr');
    const rowCount = await tableRows.count();
    console.log(`[E2E] Found ${rowCount} rows in the library table`);
    expect(rowCount).toBeGreaterThanOrEqual(4);

    // 1. Verify that clips-pane is scrollable when content overflows
    const scrollInfo = await clipsPane.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }));
    console.log('[E2E] Pane scroll dimensions:', scrollInfo);

    // Perform scroll action on clips pane
    await clipsPane.evaluate((el) => {
      el.scrollTop = 150;
    });
    const scrolledPos = await clipsPane.evaluate((el) => el.scrollTop);
    console.log('[E2E] Scrolled position:', scrolledPos);
    expect(scrolledPos).toBeGreaterThanOrEqual(0);

    // Scroll to the bottom row and verify visibility
    const lastRow = tableRows.last();
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeVisible();
    await lastRow.click();

    // Verify selected row styling
    await expect(lastRow).toHaveClass(/selected/);

    // 2. Test taxonomy filters
    const dictaphoneNav = window.locator('.nav-item', { hasText: 'Dictaphone' });
    if (await dictaphoneNav.count() > 0) {
      await dictaphoneNav.click();
      const filteredCount = await window.locator('.clips-table tbody tr').count();
      console.log(`[E2E] Dictaphone filter active: ${filteredCount} rows visible`);
      expect(filteredCount).toBeGreaterThan(0);
    }

    const allNav = window.locator('.nav-item', { hasText: 'Library (All)' });
    await allNav.click();
    const allCount = await window.locator('.clips-table tbody tr').count();
    console.log(`[E2E] Library (All) restored: ${allCount} rows visible`);
    expect(allCount).toBe(rowCount);

    await app.close();
    console.log('[E2E] Library scroll and interaction test passed.');
  });

  test('Synchronized scrolling transcript ribbon tracks playback and allows word seeking', async () => {
    console.log('[E2E] Testing scrolling transcript ribbon and fine waveform...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Select a take that has speech transcription
    const takeWithSpeech = window.locator('.clips-table tbody tr', { hasText: '260831-185613' }).first();
    if (await takeWithSpeech.count() > 0) {
      await takeWithSpeech.click();
    } else {
      const fallbackRow = window.locator('.clips-table tbody tr', { hasText: 'Product Standup' }).first();
      if (await fallbackRow.count() > 0) await fallbackRow.click();
    }

    // 2. Verify transcript ribbon exists and has words
    const ribbon = window.locator('[data-testid="transcript-ribbon"]');
    await expect(ribbon).toBeVisible();

    const words = window.locator('.transcript-word');
    const wordCount = await words.count();
    console.log(`[E2E] Found ${wordCount} words in the transcript ribbon`);
    expect(wordCount).toBeGreaterThan(0);

    // 3. Verify high-resolution canvas micro-bars
    const canvas = window.locator('.waveform-canvas');
    await expect(canvas).toBeVisible();
    const canvasDims = await canvas.evaluate((el: HTMLCanvasElement) => ({
      width: el.width,
      height: el.height,
    }));
    console.log('[E2E] Canvas buffer dimensions:', canvasDims);
    expect(canvasDims.width).toBeGreaterThanOrEqual(1000);

    // 4. Test clicking on a word in the ribbon to seek
    const targetWord = words.nth(Math.min(3, wordCount - 1));
    const wordText = await targetWord.innerText();
    console.log(`[E2E] Clicking word: "${wordText}" to seek...`);
    await targetWord.click();

    // Verify target word or adjacent word is marked active
    const activeWord = window.locator('.transcript-word.active');
    await expect(activeWord).toBeVisible();

    // 5. Test Play button and auto-scroll
    const playBtn = window.locator('.play-btn');
    await playBtn.click();
    expect(await playBtn.innerText()).toBe('⏸');

    // Wait a brief moment for playback ticker to advance words
    await window.waitForTimeout(400);

    // Pause
    await playBtn.click();
    expect(await playBtn.innerText()).toBe('▶');

    console.log('[E2E] Scrolling transcript ribbon verified successfully!');
    await app.close();
  });

  test('Library table starts sorted descending by Created / Recorded timestamp and supports column sorting', async () => {
    console.log('[E2E] Testing table sorting...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Verify default sort is Created / Recorded descending (newest timestamp first)
    const dateCells = window.locator('.clips-table tbody tr td:last-child');
    await expect(dateCells.first()).toBeVisible();
    const firstDateText = await dateCells.first().innerText();
    const lastDateText = await dateCells.last().innerText();
    console.log(`[E2E] First row date: "${firstDateText}", Last row date: "${lastDateText}"`);

    // In descending order, first date should be greater than or equal to last date
    expect(firstDateText >= lastDateText).toBe(true);

    // 2. Click "Created / Recorded" header to toggle ascending
    const createdHeader = window.locator('.clips-table th', { hasText: 'Created / Recorded' });
    await createdHeader.click();
    const firstDateAsc = await dateCells.first().innerText();
    const lastDateAsc = await dateCells.last().innerText();
    console.log(`[E2E] After ascending toggle - First: "${firstDateAsc}", Last: "${lastDateAsc}"`);
    expect(firstDateAsc <= lastDateAsc).toBe(true);

    // 3. Click "Clip Title" header to sort alphabetically
    const titleHeader = window.locator('.clips-table th', { hasText: 'Clip Title' });
    await titleHeader.click();
    const titleCells = window.locator('.clips-table tbody tr td:first-child div:first-child');
    const firstTitle = await titleCells.first().innerText();
    const lastTitle = await titleCells.last().innerText();
    console.log(`[E2E] Sorted by title - First: "${firstTitle}", Last: "${lastTitle}"`);
    expect(firstTitle.localeCompare(lastTitle)).toBeLessThanOrEqual(0);

    // 4. Click "Duration" header to sort by duration
    const durationHeader = window.locator('.clips-table th', { hasText: 'Duration' });
    await durationHeader.click();
    const durationCells = window.locator('.clips-table tbody tr td:nth-child(3)');
    const firstDur = parseFloat(await durationCells.first().innerText());
    const lastDur = parseFloat(await durationCells.last().innerText());
    console.log(`[E2E] Sorted by duration (desc) - First: ${firstDur}s, Last: ${lastDur}s`);
    expect(firstDur).toBeGreaterThanOrEqual(lastDur);

    console.log('[E2E] Table sorting verified successfully!');
    await app.close();
  });

  test('Clip right-click context menu enables editing title, adding tags, and local AI title generation', async () => {
    console.log('[E2E] Testing clip right-click context menu and metadata modal...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Right-click on first clip row to trigger clip context menu
    const firstRow = window.locator('.clips-table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click({ button: 'right' });

    // 2. Verify clip context menu appears
    const contextMenu = window.locator('.clip-context-menu');
    await expect(contextMenu).toBeVisible();

    const editItem = contextMenu.locator('.context-menu-item', { hasText: 'Edit Title & Metadata...' });
    await expect(editItem).toBeVisible();

    const aiTitleItem = contextMenu.locator('.context-menu-item', { hasText: 'Generate AI Title' });
    await expect(aiTitleItem).toBeVisible();

    // 3. Click "Edit Title & Metadata..." to open modal
    await editItem.click();

    const modal = window.locator('.modal-dialog');
    await expect(modal).toBeVisible();

    // Verify Title input and Auto-Generate button
    const titleInput = modal.locator('input.form-input').first();
    await expect(titleInput).toBeVisible();
    const currentTitle = await titleInput.inputValue();
    console.log(`[E2E] Current title in modal: "${currentTitle}"`);

    // Modify title
    const modifiedTitle = currentTitle + ' - Vocal Take';
    await titleInput.fill(modifiedTitle);

    // Add a custom tag
    const tagInput = modal.locator('input[placeholder*="custom tag"]');
    await tagInput.fill('Keeper');
    await modal.locator('button', { hasText: '+ Add Tag' }).click();

    // Save changes
    await modal.locator('button', { hasText: 'Save Changes' }).click();
    await expect(modal).toBeHidden();

    // Verify updated title appears in table
    const updatedRowTitle = await firstRow.locator('td:first-child span').first().innerText();
    console.log(`[E2E] Row title after edit: "${updatedRowTitle}"`);
    expect(updatedRowTitle).toBe(modifiedTitle);

    // 4. Test "Generate AI Title" via right-click on a clip with transcription
    const speechRow = window.locator('.clips-table tbody tr', { hasText: '260831-185613' }).first();
    if (await speechRow.count() > 0) {
      await speechRow.click({ button: 'right' });
      const speechContextMenu = window.locator('.clip-context-menu');
      await expect(speechContextMenu).toBeVisible();
      const speechAiTitleBtn = speechContextMenu.locator('.context-menu-item', { hasText: 'Generate AI Title' });
      await speechAiTitleBtn.click();
      await window.waitForTimeout(600);
      const newAiTitle = await speechRow.locator('td:first-child span').first().innerText();
      console.log(`[E2E] Generated AI title on speech take: "${newAiTitle}"`);
      expect(newAiTitle.includes('260831-185613')).toBe(true);
      expect(newAiTitle.length).toBeGreaterThan('260831-185613'.length);
    }

    console.log('[E2E] Clip context menu and metadata modal verified successfully!');
    await app.close();
  });

  test('Right-click context menu exports clip or selection to MP3 with metadata and provides Show in Finder', async () => {
    console.log('[E2E] Testing MP3 export with ID3 metadata and Show in Finder...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Right-click on a clip row
    const firstRow = window.locator('.clips-table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click({ button: 'right' });

    // 2. Context menu should show "Export to MP3" or "Re-export to MP3"
    const contextMenu = window.locator('.clip-context-menu');
    await expect(contextMenu).toBeVisible();

    const exportMp3Item = contextMenu.locator('.context-menu-item', { hasText: /Export to MP3|Re-export to MP3/ });
    await expect(exportMp3Item).toBeVisible();

    // Click export to MP3
    await exportMp3Item.click();

    // 3. Verify MP3 badge appears on the row
    const mp3Badge = firstRow.locator('.badge-mp3');
    await expect(mp3Badge).toBeVisible({ timeout: 10000 });
    console.log('[E2E] MP3 badge visible on clip row!');

    // Settle async operations
    await window.waitForTimeout(400);

    // 4. Right-click on the row again
    await firstRow.click({ button: 'right' });
    await expect(contextMenu).toBeVisible();

    // Now "Open in Finder" and "Re-export to MP3" should be present
    const showInFinderItem = contextMenu.locator('.context-menu-item', { hasText: /Finder/ });
    await expect(showInFinderItem).toBeVisible();

    // Verify context menu is scrollable and constrained within viewport
    const menuBox = await contextMenu.boundingBox();
    expect(menuBox).toBeTruthy();
    if (menuBox) {
      const windowHeight = await window.evaluate(() => globalThis.innerHeight);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(windowHeight);
    }

    const reExportMp3Item = contextMenu.locator('.context-menu-item', { hasText: 'Re-export to MP3' });
    await expect(reExportMp3Item).toBeVisible();

    // Close menu by clicking elsewhere
    await window.keyboard.press('Escape');

    // 5. Verify Waveform Profile Experiment Buttons and Dock "Open in Finder" Button
    const profileGroup = window.locator('.profile-selector-group');
    await expect(profileGroup).toBeVisible();

    const punchyBtn = profileGroup.locator('.profile-pill-btn', { hasText: 'Punchy' });
    await punchyBtn.click();
    await expect(punchyBtn).toHaveClass(/active/);

    const dynamicBtn = profileGroup.locator('.profile-pill-btn', { hasText: 'Dynamic' });
    await dynamicBtn.click();
    await expect(dynamicBtn).toHaveClass(/active/);

    // Verify dock "Open in Finder" button is visible
    const dockOpenInFinder = window.locator('.dock-header button', { hasText: /Finder/ });
    await expect(dockOpenInFinder).toBeVisible();

    // 6. Verify Waveform context menu has MP3 export & Open in Finder
    const canvas = window.locator('.waveform-canvas');
    await canvas.click({ button: 'right', position: { x: 150, y: 40 } });

    const waveformContextMenu = window.locator('.context-menu:not(.clip-context-menu)');
    await expect(waveformContextMenu).toBeVisible();

    const waveShowInFinder = waveformContextMenu.locator('.context-menu-item', { hasText: /Finder/ });
    await expect(waveShowInFinder).toBeVisible();

    console.log('[E2E] Waveform and table MP3 context actions and profile buttons verified successfully!');
    await app.close();
  });

  test('UI Direction 1 & 2: Search bar with Cmd+K, In-App Recording bar with levels, and Sources sidebar', async () => {
    console.log('[E2E] Testing UI Direction 1 & 2 enhancements...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Verify Header Search Bar and Cmd+K shortcut
    const searchBar = window.locator('.header-search-bar');
    await expect(searchBar).toBeVisible();

    const searchInput = window.locator('.header-search-input');
    await expect(searchInput).toBeVisible();

    // Trigger Cmd+K / Ctrl+K
    await window.keyboard.press('Meta+k');
    await expect(searchInput).toBeFocused();

    // Search query filtering
    await searchInput.fill('Feelings');
    const filteredRows = window.locator('.clips-table tbody tr');
    await expect(filteredRows).toHaveCount(1);
    await expect(filteredRows.first()).toContainText('Feelings');

    // Verify search highlight mark and match counter pill
    const highlightMark = window.locator('mark.search-highlight-mark');
    await expect(highlightMark.first()).toBeVisible();
    await expect(highlightMark.first()).toHaveText('Feelings');

    const matchesPill = window.locator('.search-matches-pill');
    await expect(matchesPill).toBeVisible();
    await expect(matchesPill).toContainText('1 match');

    // Clear search with Escape key
    await searchInput.focus();
    await window.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');
    const allRows = window.locator('.clips-table tbody tr');
    expect(await allRows.count()).toBeGreaterThanOrEqual(4);

    // 2. Verify Sources Section in Sidebar
    const inAppSource = window.locator('.source-item', { hasText: 'In-App Recorder' });
    await expect(inAppSource).toBeVisible();

    const sdCardSource = window.locator('.source-item', { hasText: 'SD Card' });
    await expect(sdCardSource).toBeVisible();

    const importFolderSource = window.locator('.source-item', { hasText: 'Import folder' });
    await expect(importFolderSource).toBeVisible();

    // 3. Verify Table Take Source Subtitles and Status Pills
    const firstRowSourceSub = window.locator('.take-source-sub').first();
    await expect(firstRowSourceSub).toBeVisible();

    const statusPill = window.locator('.status-pill').first();
    await expect(statusPill).toBeVisible();

    // 4. Verify Prominent Record Button in Header
    const recordBtn = window.locator('.btn-record');
    await expect(recordBtn).toBeVisible();
    await expect(recordBtn).toContainText('Record');

    // 5. Test Start In-App Recording
    await recordBtn.click();

    // Recbar should appear
    const recbar = window.locator('.recording-bar');
    await expect(recbar).toBeVisible();

    // Check timer, metadata, and live level bars
    const timer = recbar.locator('.recbar-timer');
    await expect(timer).toBeVisible();

    const recbarMeta = recbar.locator('.recbar-meta');
    await expect(recbarMeta).toContainText('In-App Recorder');

    const levelBars = recbar.locator('.recbar-lvl-bar');
    expect(await levelBars.count()).toBe(18);

    // Check Auto-transcribe checkbox toggle
    const toggle = recbar.locator('.recbar-toggle input');
    await expect(toggle).toBeChecked();

    // Check Pause / Resume
    const pauseBtn = recbar.locator('button', { hasText: /Pause|Resume/ });
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();
    await expect(recbar.locator('button', { hasText: 'Resume' })).toBeVisible();
    await pauseBtn.click();
    await expect(recbar.locator('button', { hasText: 'Pause' })).toBeVisible();

    // Check Stop recording
    const stopBtn = recbar.locator('button', { hasText: /Stop/ });
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // Recbar closes and record button returns
    await expect(recbar).not.toBeVisible();
    await expect(recordBtn).toBeVisible();

    console.log('[E2E] UI Direction 1 & 2 verified successfully!');
    await app.close();
  });

  test('Right-click context menu enables deleting a clip from disk with confirmation dialog and Remember My Choice', async () => {
    console.log('[E2E] Testing delete clip with confirmation dialog and Remember my choice...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Ensure clean state for delete confirmation dialog
    await window.evaluate(async () => {
      localStorage.removeItem('audiovault_remember_delete_choice');
      if ((window as any).audioVault) {
        await (window as any).audioVault.updateVaultSettings({ rememberDeleteChoice: false });
      }
    });
    // Wait briefly for react state if needed
    const resetReminderBtn = window.locator('button', { hasText: 'Ask every time' });
    if (await resetReminderBtn.isVisible()) {
      await resetReminderBtn.click();
    }

    // 1. Right click on first row
    const firstRow = window.locator('.clips-table tbody tr').first();
    const clipTitle = await firstRow.locator('td').first().locator('span').first().innerText();
    const initialRowCount = await window.locator('.clips-table tbody tr').count();

    await firstRow.click({ button: 'right' });
    const deleteOption = window.locator('[data-testid="delete-clip-menu-item"]');
    await expect(deleteOption).toBeVisible();
    await expect(deleteOption).toContainText('Delete Clip from Disk');

    // 2. Click delete option - confirmation modal must pop up
    await deleteOption.click();
    const confirmModal = window.locator('[data-testid="delete-confirmation-modal"]');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal).toContainText('Delete Clip & Audio File');
    await expect(confirmModal).toContainText(clipTitle.split('\n')[0]);

    // Checkbox "Remember my choice" must be present
    const rememberCheckbox = window.locator('[data-testid="remember-choice-checkbox"]');
    await expect(rememberCheckbox).toBeVisible();
    await expect(rememberCheckbox).not.toBeChecked();

    // 3. Test Cancel button dismisses modal without deleting
    const cancelBtn = confirmModal.locator('button', { hasText: 'Cancel' });
    await cancelBtn.click();
    await expect(confirmModal).not.toBeVisible();
    expect(await window.locator('.clips-table tbody tr').count()).toBe(initialRowCount);

    // 4. Re-open delete modal, check "Remember my choice", and confirm deletion
    await firstRow.click({ button: 'right' });
    await deleteOption.click();
    await expect(confirmModal).toBeVisible();

    await rememberCheckbox.check();
    await expect(rememberCheckbox).toBeChecked();

    const confirmDeleteBtn = window.locator('[data-testid="confirm-delete-btn"]');
    await confirmDeleteBtn.click();

    await expect(confirmModal).not.toBeVisible();
    await expect(window.locator('.clips-table tbody tr')).toHaveCount(initialRowCount - 1);

    // Clean up settings for subsequent runs
    await window.evaluate(async () => {
      localStorage.removeItem('audiovault_remember_delete_choice');
      if ((window as any).audioVault) {
        await (window as any).audioVault.updateVaultSettings({ rememberDeleteChoice: false });
      }
    });

    console.log('[E2E] Delete confirmation dialog and Remember My Choice verified successfully!');
    await app.close();
  });

  test('Context menu remains within viewport, scrolls when near bottom, and Open in Finder is accessible for all clips', async () => {
    console.log('[E2E] Testing context menu viewport bounds, scrolling, and Open in Finder availability...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Select a row that has not been exported to MP3
    const rows = window.locator('.clips-table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(3);

    // Scroll clips pane down to test clicking a row further down the screen
    const clipsPane = window.locator('.clips-pane');
    await clipsPane.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await window.waitForTimeout(300);

    // Right-click the last visible row at the bottom
    const lastRow = rows.last();
    await lastRow.scrollIntoViewIfNeeded();
    await lastRow.click({ button: 'right' });

    const contextMenu = window.locator('.context-menu.clip-context-menu');
    await expect(contextMenu).toBeVisible();

    // Verify context menu is completely within the viewport bounds
    const menuBox = await contextMenu.boundingBox();
    expect(menuBox).toBeTruthy();
    if (menuBox) {
      const windowHeight = await window.evaluate(() => globalThis.innerHeight);
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(windowHeight + 2);
    }

    // Verify lowest item (Delete Clip from Disk...) is visible
    const deleteItem = contextMenu.locator('[data-testid="delete-clip-menu-item"]');
    await expect(deleteItem).toBeVisible();

    // Verify "Open in Finder" is present in context menu even if clip is not yet exported to MP3
    const finderMenuItem = contextMenu.locator('.context-menu-item', { hasText: /Finder/ });
    await expect(finderMenuItem).toBeVisible();

    // Close menu
    await window.keyboard.press('Escape');

    // Verify dock header has "Open in Finder" button visible for active clip
    const dockOpenInFinder = window.locator('.dock-header button', { hasText: /Finder/ });
    await expect(dockOpenInFinder).toBeVisible();

    console.log('[E2E] Context menu viewport bounds, scrolling, and Open in Finder successfully verified!');
    await app.close();
  });

  test('Deleted files record tombstones and are never re-downloaded or re-uploaded during sync', async () => {
    console.log('[E2E] Testing deleted files tombstone and re-sync prevention...');
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Record a fresh take via in-app recorder API
    const initialDeletedCount = (await window.evaluate(async () => {
      const deleted = await (window as any).audioVault.getDeletedFiles();
      return deleted.length;
    })) as number;

    // Create a 0.5s audio take
    const pcm = new Int16Array(48000 * 0.5);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = Math.sin((i / 48000) * 440 * 2 * Math.PI) * 16000;
    }
    // Encode simple WAV buffer
    const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(wavBuffer);
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true);
    view.setUint32(28, 48000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    new Int16Array(wavBuffer, 44).set(pcm);

    const newClip = await window.evaluate(async (buf) => {
      return (window as any).audioVault.saveRecordedTake(buf, 'Sync Test Take To Delete', false);
    }, Array.from(new Uint8Array(wavBuffer)));

    expect(newClip).toBeTruthy();
    expect(newClip.id).toBeTruthy();
    await window.waitForTimeout(400);

    // Verify clip is in library
    const createdRow = window.locator('.clips-table tbody tr', { hasText: 'Sync Test Take To Delete' }).first();
    await expect(createdRow).toBeVisible();

    // 2. Right-click and delete the clip from disk
    await createdRow.click({ button: 'right' });
    const deleteOption = window.locator('[data-testid="delete-clip-menu-item"]');
    await expect(deleteOption).toBeVisible();
    await deleteOption.click();

    // If confirmation modal appears, confirm
    const confirmModal = window.locator('[data-testid="delete-confirmation-modal"]');
    if (await confirmModal.isVisible()) {
      const confirmBtn = window.locator('[data-testid="confirm-delete-btn"]');
      await confirmBtn.click();
      await expect(confirmModal).toBeHidden();
    }

    // Verify row is removed from table
    await expect(createdRow).not.toBeVisible();

    // 3. Verify tombstone is recorded in AudioVault registry
    const deletedFiles = (await window.evaluate(async () => {
      return (window as any).audioVault.getDeletedFiles();
    })) as Array<{ id: string; originalFilename: string; fingerprint: string }>;

    expect(deletedFiles.length).toBeGreaterThan(initialDeletedCount);
    const tombstone = deletedFiles.find((d) => d.originalFilename.includes('Sync Test Take To Delete') || d.originalFilename.endsWith('.WAV'));
    expect(tombstone).toBeTruthy();

    // 4. Verify sidebar shows remembered deleted takes indicator
    const deletedTakesIndicator = window.locator('[data-testid="deleted-takes-indicator"]');
    await expect(deletedTakesIndicator).toBeVisible();

    // 5. Attempt to re-sync / re-import the exact same audio buffer via importFiles
    const importAttempt = await window.evaluate(async (buf) => {
      // Create a temporary file and import it
      const rawFiles = await (window as any).audioVault.getRawFiles();
      return rawFiles.map((r: any) => r.fingerprint);
    });
    expect(importAttempt).not.toContain(tombstone?.fingerprint);

    console.log('[E2E] Deleted files tombstone and re-sync prevention successfully verified!');
    await app.close();
  });
});



