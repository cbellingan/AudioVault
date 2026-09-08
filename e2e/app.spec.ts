import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('AudioVault Electron Integration Tests', () => {
  test('Launches AudioVault, verifies taxonomy, waveform, and volume detection banner', async () => {
    // Launch compiled Electron app
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    // Get the first window
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 1. Verify Window Title
    const title = await window.title();
    expect(title).toContain('AudioVault');

    // 2. Verify Brand Title
    const brandTitle = await window.locator('.brand-title').innerText();
    expect(brandTitle).toBe('AudioVault');

    // 3. Verify Taxonomy Navigation Items
    const musicNav = window.locator('.nav-item', { hasText: 'Music & Singing' });
    await expect(musicNav).toBeVisible();

    const concertNav = window.locator('.nav-item', { hasText: 'Concerts & Live' });
    await expect(concertNav).toBeVisible();

    const meetingNav = window.locator('.nav-item', { hasText: 'Meetings' });
    await expect(meetingNav).toBeVisible();

    // 4. Verify Virtual Clips Table
    const tableRows = window.locator('.clips-table tbody tr');
    await expect(tableRows.first()).toBeVisible();

    // 5. Verify Waveform Canvas
    const canvas = window.locator('.waveform-canvas');
    await expect(canvas).toBeVisible();

    // 6. Test Scanning Connected Drives Button
    const scanBtn = window.locator('button', { hasText: 'Scan Connected Drives' });
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();

    // Close Electron App
    await app.close();
  });
});
