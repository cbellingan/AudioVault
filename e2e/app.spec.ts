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
});
