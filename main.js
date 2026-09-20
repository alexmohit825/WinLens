// ============================================================
// WinLens — Electron Main Process
// Handles: screen capture, global hotkey, tray, IPC, window
// ============================================================
'use strict';

const {
  app, BrowserWindow, globalShortcut, desktopCapturer,
  ipcMain, Tray, Menu, nativeImage, screen, shell,
} = require('electron');
const path = require('path');

// ── Config ────────────────────────────────────────────────────
const HOTKEY = 'Alt+Shift+W';
const WINDOW_WIDTH = 440;
const WINDOW_HEIGHT = 760;
const IS_DEV = process.argv.includes('--dev');

let mainWindow = null;
let tray = null;
let isCapturing = false;

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: workArea.x + workArea.width - WINDOW_WIDTH - 16,
    y: workArea.y + 16,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    minWidth: 360,
    minHeight: 500,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    icon: path.join(__dirname, 'build', 'icon.png'),
    title: 'WinLens',
    backgroundColor: '#0D0D14',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ── Screen Capture ────────────────────────────────────────────
async function captureScreen() {
  if (isCapturing) return;
  isCapturing = true;

  try {
    // Brief hide so WinLens doesn't appear in its own screenshot
    const wasVisible = mainWindow.isVisible();
    if (wasVisible) mainWindow.hide();
    await new Promise(r => setTimeout(r, 150));

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });

    if (wasVisible) mainWindow.show();

    if (!sources || sources.length === 0) {
      mainWindow.webContents.send('capture-error', 'No screen source found.');
      return;
    }

    const dataUrl = sources[0].thumbnail.toDataURL('image/jpeg', 0.82);
    mainWindow.webContents.send('screenshot-captured', dataUrl);

    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  } catch (err) {
    mainWindow.webContents.send('capture-error', err.message);
  } finally {
    isCapturing = false;
  }
}

// ── IPC Handlers ──────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('capture-screen', () => captureScreen());
  ipcMain.handle('hide-window', () => mainWindow?.hide());
  ipcMain.handle('get-hotkey', () => HOTKEY);
  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
  ipcMain.on('set-always-on-top', (_, val) => mainWindow?.setAlwaysOnTop(val));
}

// ── System Tray ───────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip(`WinLens  •  ${HOTKEY} to capture`);

  const menu = Menu.buildFromTemplate([
    { label: 'WinLens — AI Screen Assistant', enabled: false },
    { type: 'separator' },
    { label: `Capture Screen  (${HOTKEY})`, click: () => { mainWindow.show(); mainWindow.focus(); captureScreen(); } },
    { label: 'Show / Hide Panel', click: () => mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus()) },
    { type: 'separator' },
    { label: 'Quit WinLens', click: () => { app.exit(0); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });
}

// ── App Lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupIPC();

  // Global hotkey — works in any app
  const registered = globalShortcut.register(HOTKEY, () => {
    mainWindow.show();
    mainWindow.focus();
    captureScreen();
  });

  if (!registered) {
    console.warn(`[WinLens] Could not register hotkey ${HOTKEY} — may be taken by another app.`);
  }

  // Show window on first launch
  mainWindow.show();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
  if (process.platform !== 'darwin') return;
  app.quit();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
