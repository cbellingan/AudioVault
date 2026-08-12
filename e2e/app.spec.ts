import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('MakerHub Electron Integration Tests', () => {
  test('Launches Electron app, renders UI elements, and interacts with channel sync', async () => {
    // Launch Electron application
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main/index.js')],
    });

    // Get the main window
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Verify Window Title
    const title = await window.title();
    expect(title).toContain('MakerHub');

    // Verify Header Elements
    const brandTitle = await window.locator('.brand-title').innerText();
    expect(brandTitle).toBe('MakerHub');

    // Verify Sales Channels Section
    const channelCards = window.locator('.channel-card');
    await expect(channelCards).toHaveCount(4);

    // Verify Sync Button and click action
    const syncBtn = window.locator('button', { hasText: 'Sync All Channels' });
    await expect(syncBtn).toBeVisible();
    await syncBtn.click();

    // Verify Sync Console entry updated
    const consoleEntry = window.locator('.console-box');
    await expect(consoleEntry).toContainText('Full Catalogue & Stock Sync');

    // Close Electron App
    await app.close();
  });
});
