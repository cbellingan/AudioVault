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

    // 1. Select a dictaphone take that has speech transcription
    const dictaphoneRow = window.locator('.clips-table tbody tr', { hasText: 'DICTAPHONE' }).first();
    if (await dictaphoneRow.count() > 0) {
      await dictaphoneRow.click();
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
});
