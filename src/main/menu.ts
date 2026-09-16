import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from 'electron';

export function setupApplicationMenu(getMainWindow: () => BrowserWindow | null) {
  const isMac = process.platform === 'darwin';

  const sendAction = (action: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:menu-action', action, ...args);
    }
  };

  const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: 'About AudioVault',
                click: () => sendAction('about'),
              },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendAction('nav-settings'),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Import Audio…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendAction('import-audio'),
        },
        {
          label: 'Import Folder…',
          accelerator: 'Shift+CmdOrCtrl+O',
          click: () => sendAction('import-folder'),
        },
        { type: 'separator' },
        {
          label: 'New Recording',
          accelerator: 'Shift+CmdOrCtrl+R',
          click: () => sendAction('new-recording'),
        },
        {
          label: 'New Collection…',
          accelerator: 'Shift+CmdOrCtrl+N',
          click: () => sendAction('new-collection'),
        },
        {
          label: 'Export…',
          accelerator: 'Shift+CmdOrCtrl+E',
          click: () => sendAction('export'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Transcript…',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendAction('find-in-transcript'),
        },
        {
          label: 'Copy Transcript',
          accelerator: 'Shift+CmdOrCtrl+C',
          click: () => sendAction('copy-transcript'),
        },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play / Pause',
          accelerator: 'Space',
          click: () => sendAction('play-pause'),
        },
        {
          label: 'Skip Back 10 Seconds',
          accelerator: 'Alt+Left',
          click: () => sendAction('skip-back'),
        },
        {
          label: 'Skip Forward 10 Seconds',
          accelerator: 'Alt+Right',
          click: () => sendAction('skip-forward'),
        },
      ],
    },
    {
      label: 'Recording',
      submenu: [
        {
          label: 'Transcribe…',
          accelerator: 'Shift+CmdOrCtrl+T',
          click: () => sendAction('transcribe'),
        },
        {
          label: 'Rename…',
          click: () => sendAction('rename'),
        },
        {
          label: 'Add to Collection…',
          click: () => sendAction('add-to-collection'),
        },
        {
          label: 'Mark Reviewed',
          click: () => sendAction('mark-reviewed'),
        },
        {
          label: 'Toggle Favorite',
          click: () => sendAction('toggle-favorite'),
        },
        {
          label: 'Save Excerpt…',
          click: () => sendAction('save-excerpt'),
        },
        { type: 'separator' },
        {
          label: 'Show in Finder',
          click: () => sendAction('show-in-finder'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'All Recordings',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendAction('nav-library'),
        },
        {
          label: 'Imports',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendAction('nav-imports'),
        },
        {
          label: 'Show Recording Details',
          accelerator: 'CmdOrCtrl+D',
          click: () => sendAction('show-details'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev
          ? [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { role: 'forceReload' as const },
              { role: 'toggleDevTools' as const },
            ]
          : []),
      ],
    },
    {
      role: 'windowMenu',
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Getting Started',
          click: () => sendAction('help-getting-started'),
        },
        {
          label: 'Keyboard Shortcuts',
          click: () => sendAction('help-shortcuts'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
