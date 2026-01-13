import { app, BrowserWindow, globalShortcut, ipcMain, Tray, nativeImage, Menu, screen } from 'electron';
import { exec } from 'child_process';
import { join, resolve, relative, sep, dirname } from 'path';
import { promises as fs } from 'fs';
import { homedir } from 'os';

// Path constants
const OBSIDIAN_DOCUMENTS_PATH = join(homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents');
const SETTINGS_FILE_PATH = join(app.getPath('userData'), 'settings.json');

interface Settings {
    vaultPath: string;
    theme?: 'dark' | 'light' | 'system';
    outputs?: OutputConfig[];
}

type BuiltInOutputId = 'inbox' | 'daily-note';

interface OutputConfig {
    /** User-visible name, e.g. "Inbox" */
    name: string;
    /** Relative path within the vault, e.g. "0_Inbox/Inbox.md" or "5_Calendar/yyyy-mm-dd.md" */
    path: string;
    /** Optional stable id for built-in outputs so older calls keep working */
    id?: BuiltInOutputId;
}

const getInitialSettings = (): Settings => ({
    vaultPath: '',
    theme: 'system',
    outputs: [
        { id: 'inbox', name: 'Inbox', path: 'Inbox/Inbox.md' },
        { id: 'daily-note', name: 'Daily Note', path: 'Calendar/yyyy-mm-dd.md' },
    ],
});

function expandPathPlaceholders(template: string, now = new Date()): string {
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    // Support yyyy-mm-dd anywhere in string, plus individual tokens.
    return template
        .replaceAll('yyyy-mm-dd', `${yyyy}-${mm}-${dd}`)
        .replaceAll('yyyy', yyyy)
        .replaceAll('mm', mm)
        .replaceAll('dd', dd);
}

async function resolveVaultFilePath(vaultPath: string, relativePath: string): Promise<string> {
    // Normalize to prevent absolute paths and traversal.
    const normalizedRel = relativePath.replace(/^[\\/]+/, '').replaceAll('\\', '/');
    const abs = resolve(vaultPath, normalizedRel);

    const vaultResolved = resolve(vaultPath);
    const vaultPrefix = vaultResolved.endsWith(sep) ? vaultResolved : vaultResolved + sep;

    // Fast path: purely lexical check after resolve().
    if (!(abs === vaultResolved || abs.startsWith(vaultPrefix))) {
        throw new Error('Output path must be inside the selected vault');
    }

    // Tighten using real paths (symlink-aware) when possible.
    // We resolve the vault root and the nearest existing parent directory of the target.
    try {
        const vaultReal = await fs.realpath(vaultResolved);

        // find nearest existing parent of abs
        let probe = abs;
        // For a file path, start at its directory.
        probe = dirname(probe);

        while (true) {
            try {
                const st = await fs.stat(probe);
                if (st.isDirectory()) break;
            } catch {
                // keep walking up
            }
            const parent = dirname(probe);
            if (parent === probe) break;
            probe = parent;
        }

        const probeReal = await fs.realpath(probe);
        const vaultRealPrefix = vaultReal.endsWith(sep) ? vaultReal : vaultReal + sep;
        if (!(probeReal === vaultReal || probeReal.startsWith(vaultRealPrefix))) {
            throw new Error('Output path must be inside the selected vault');
        }
    } catch {
        // If realpath/stat fails (e.g. vault temporarily unavailable), keep the resolve() based check.
    }

    return abs;
}

function getOutputById(id: BuiltInOutputId): OutputConfig {
    const outputs = settings.outputs ?? getInitialSettings().outputs ?? [];
    const found = outputs.find(o => o.id === id);
    if (found) return found;
    // fallback to defaults
    const fallback = (getInitialSettings().outputs ?? []).find(o => o.id === id);
    if (!fallback) throw new Error(`Missing output configuration for ${id}`);
    return fallback;
}

async function appendToOutput(output: OutputConfig, text: string, now = new Date()) {
    if (!settings.vaultPath) {
        throw new Error('No vault selected. Please go to settings.');
    }
    const expandedRel = expandPathPlaceholders(output.path, now);
    const absFile = await resolveVaultFilePath(settings.vaultPath, expandedRel);
    await fs.mkdir(dirname(absFile), { recursive: true });
    await fs.appendFile(absFile, `\n${text}`, 'utf8');
}

let settings: Settings = getInitialSettings();
let mainWindow: BrowserWindow | null = null;
let optionsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let timerInterval: NodeJS.Timeout | null = null;
let timerStart: number | null = null; // epoch ms when timer started
let timerDescription = '';
let timerDestination: 'Inbox' | 'Daily Note' | null = null;
let timerPaused = false;
let timerPausedElapsed = 0; // accumulated elapsed ms while paused
let autoHideLocked = false;

async function loadSettings() {
    try {
        const data = await fs.readFile(SETTINGS_FILE_PATH, 'utf8');
        settings = { ...getInitialSettings(), ...JSON.parse(data) };
    } catch {
        // Use defaults
    }
}

async function saveSettings() {
    try {
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 750,
        height: 60, // Initial height for single line
        show: false, // Start hidden
        frame: false, // Frameless
        transparent: true, // Transparent for custom UI
        resizable: true,
        hasShadow: true,
        skipTaskbar: true, // Don't show in taskbar/dock (optional, maybe configurable)
        webPreferences: {
            preload: join(__dirname, '../../dist/preload/index.js'),
            sandbox: false, // Required for some preload actions if not careful, but contextIsolation is on
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Load the local URL for development or the local file for production
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        // mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(join(__dirname, '../../dist/renderer/index.html'));
    }

    // Hide window when it loses focus
    mainWindow.on('blur', () => {
        // Don't auto-hide while timer is running or when auto-hide is temporarily locked
        if (!timerInterval && !autoHideLocked) {
            mainWindow?.hide();
        }
    });
};

const createOptionsWindow = () => {
    if (optionsWindow) {
        optionsWindow.focus();
        return;
    }

    optionsWindow = new BrowserWindow({
        width: 640,
        height: 700,
        minWidth: 480,
        minHeight: 320,
        resizable: true,
        show: false, // Start hidden to prevent flash
        frame: false, // Frameless like the command bar
        transparent: true, // Transparent so the renderer draws the UI
        skipTaskbar: true,
        title: 'OpenCapture Options',
        backgroundColor: '#1a1b1e', // Match app background (used as a fallback)
        webPreferences: {
            preload: join(__dirname, '../../dist/preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Load the same URL but with a hash for routing
    if (process.env.NODE_ENV === 'development') {
        optionsWindow.loadURL('http://localhost:5173/#options');
    } else {
        optionsWindow.loadFile(join(__dirname, '../../dist/renderer/index.html'), { hash: 'options' });
    }

    optionsWindow.once('ready-to-show', () => {
        // Wait for renderer to report content height before showing to avoid transparent gaps
        // Renderer will call 'resize-options-window' which will show the window after sizing.
    });

    optionsWindow.on('closed', () => {
        optionsWindow = null;
    });
};
// IPC Handlers
ipcMain.handle('append-to-inbox', async (_event, text: string) => {
    try {
        const out = getOutputById('inbox');
        await appendToOutput(out, text);
        return { success: true };
    } catch (error) {
        console.error('Failed to append to file:', error);
        return { success: false, error: (error as Error).message };
    }
});

ipcMain.handle('append-to-daily-note', async (_event, text: string) => {
    try {
        const out = getOutputById('daily-note');
        await appendToOutput(out, text, new Date());
        return { success: true };
    } catch (error) {
        console.error('Failed to append to daily note:', error);
        return { success: false, error: (error as Error).message };
    }
});

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('update-settings', async (_event, newSettings: Partial<Settings>) => {
    settings = { ...settings, ...newSettings };
    await saveSettings();
    // Notify all renderer windows about the updated settings so they can react without restart
    try {
        BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-updated', settings));
    } catch (e) {
        console.warn('Failed to broadcast settings-updated', e);
    }
    return settings;
});

ipcMain.handle('list-vaults', async () => {
    try {
        const entries = await fs.readdir(OBSIDIAN_DOCUMENTS_PATH, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => ({
                name: entry.name,
                path: join(OBSIDIAN_DOCUMENTS_PATH, entry.name)
            }));
    } catch (error) {
        console.error('Failed to list vaults:', error);
        return [];
    }
});

ipcMain.on('hide-window', () => {
    mainWindow?.hide();
});

ipcMain.on('resize-window', (_event, height: number) => {
    if (mainWindow) {
        mainWindow.setSize(750, height);
    }
});

ipcMain.on('open-options', () => {
    createOptionsWindow();
});

ipcMain.on('resize-options-window', (_event, height: number) => {
    if (optionsWindow) {
        // Keep current width, only adjust height but clamp to the primary display work area
        const [width] = optionsWindow.getSize();
        try {
            const display = screen.getDisplayMatching(optionsWindow.getBounds());
            const maxHeight = display.workAreaSize.height - 40; // leave some margin
            const newHeight = Math.max(200, Math.min(Math.round(height), maxHeight));
            optionsWindow.setSize(width, newHeight);
            if (!optionsWindow.isVisible()) {
                optionsWindow.show();
            }
        } catch (e) {
            optionsWindow.setSize(width, Math.max(200, Math.round(height)));
        }
    }
});

function ensureTray() {
    if (tray) return;
    // Resolve path to bundled asset or source asset depending on environment
    // In development, assets live in src/assets relative to project root
    // In production, the renderer is built into dist and assets are copied alongside the app; try __dirname relative lookup
    let iconPath: string;
    if (process.env.NODE_ENV === 'development') {
        iconPath = join(__dirname, '../../src/assets/opencapture_icon_tray.png');
    } else {
        iconPath = join(__dirname, '../../assets/opencapture_icon_tray.png');
    }

    let img: Electron.NativeImage;
    img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img);
    tray.setToolTip('OpenCapture Timer');
    // Build initial menu
    updateTrayMenu();
    tray.on('click', () => {
        try {
            tray?.popUpContextMenu();
        } catch (e) {}
    });
}

function updateTrayMenu() {
    if (!tray) return;
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: timerInterval ? 'Stop Timer' : 'No timer running',
            enabled: !!timerInterval,
            click: async () => {
                try {
                    await stopTimerLogic();
                } catch (e) {
                    console.error('Failed to stop timer from tray menu', e);
                }
            }
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    tray.setContextMenu(menu);
}

async function stopTimerLogic() {
    if (timerInterval) {
        clearInterval(timerInterval as NodeJS.Timeout);
        timerInterval = null;
    }
    const hadStart = timerStart !== null;
    const recordedDestination = timerDestination;
    const recordedStart = timerStart;
    timerStart = null;
    timerDescription = '';
    timerDestination = null;
    if (tray) {
        try {
            tray.setTitle('');
        } catch (e) {
            // ignore
        }
    }

    // append record if we had a start and destination
    if (hadStart && recordedDestination && recordedStart !== null) {
        const start = new Date(recordedStart);
        const end = new Date();
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')} ${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}:${String(start.getSeconds()).padStart(2, '0')}`;
        const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')} ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}:${String(end.getSeconds()).padStart(2, '0')}`;
        const line = `- ${startStr} - ${endStr}\n`;
        try {
            if (recordedDestination === 'Inbox') {
                const out = getOutputById('inbox');
                // appendToOutput adds its own leading newline; we already have one in line, so write directly
                if (!settings.vaultPath) throw new Error('No vault selected');
                const expandedRel = expandPathPlaceholders(out.path, new Date());
                const absFile = await resolveVaultFilePath(settings.vaultPath, expandedRel);
                await fs.mkdir(dirname(absFile), { recursive: true });
                await fs.appendFile(absFile, line, 'utf8');
            } else if (recordedDestination === 'Daily Note') {
                const out = getOutputById('daily-note');
                if (!settings.vaultPath) throw new Error('No vault selected');
                const expandedRel = expandPathPlaceholders(out.path, new Date());
                const absFile = await resolveVaultFilePath(settings.vaultPath, expandedRel);
                await fs.mkdir(dirname(absFile), { recursive: true });
                await fs.appendFile(absFile, line, 'utf8');
            }
        } catch (err) {
            console.error('Failed to append timer record:', err);
        }
    }

    try {
        const state = { running: false };
        BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', state));
    } catch (e) {}

    // Refresh tray menu
    updateTrayMenu();
}

function formatElapsed(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTrayTitle() {
    if (!tray) return;
    let elapsed = 0;
    if (timerStart !== null) {
        elapsed = Date.now() - timerStart;
    } else if (timerPaused) {
        elapsed = timerPausedElapsed;
    } else {
        return;
    }
    const timeStr = formatElapsed(elapsed);
    // When paused, append ' (paused)' in lowercase brackets at the end
    const base = `${timeStr} - ${timerDescription}`;
    const title = timerPaused ? `${base} (paused)` : base;
    // setTitle works on macOS to show text in status bar
    try {
        tray.setTitle(title);
    } catch (e) {
        // Some platforms may not support setTitle; ignore
    }
    // Broadcast timer tick to renderer windows
    try {
        const state = { running: true, elapsed, description: timerDescription, paused: !!timerPaused };
        BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', state));
    } catch (e) {
        // ignore
    }
}

ipcMain.handle('start-timer', async (_event, description: string, destination?: 'Inbox' | 'Daily Note') => {
    if (timerInterval) {
        // already running
        return { running: true };
    }
    timerDescription = description || '';
    if (destination) timerDestination = destination;
    // If currently paused, resume from accumulated elapsed
    if (timerPaused) {
        timerStart = Date.now() - timerPausedElapsed;
        timerPaused = false;
        timerPausedElapsed = 0;
    } else {
        timerStart = Date.now();
    }
    // If destination provided via args, it will be set by caller; otherwise keep existing
    ensureTray();
    updateTrayTitle();
    timerInterval = setInterval(updateTrayTitle, 1000);
    return { running: true };
});

ipcMain.handle('stop-timer', async () => {
    // stopping should also clear paused state
    timerPaused = false;
    timerPausedElapsed = 0;
    await stopTimerLogic();
    return { running: false };
});

ipcMain.handle('toggle-timer', async (_event, description: string, destination?: 'Inbox' | 'Daily Note') => {
    if (destination) timerDestination = destination;
    if (timerInterval) {
        // stop (fully end timer and record)
        if (timerInterval) {
            clearInterval(timerInterval as NodeJS.Timeout);
            timerInterval = null;
        }
        timerStart = null;
        timerDescription = '';
        // clear destination
        timerDestination = null;
        // clear paused state just in case
        timerPaused = false;
        timerPausedElapsed = 0;
        if (tray) {
            try { tray.setTitle(''); } catch (e) {}
        }
        try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', { running: false })); } catch (e) {}
        return { running: false };
    } else {
        // If paused, resume instead of starting fresh
        if (timerPaused) {
            // resume
            timerStart = Date.now() - timerPausedElapsed;
            timerPaused = false;
            timerPausedElapsed = 0;
            ensureTray();
            updateTrayTitle();
            timerInterval = setInterval(updateTrayTitle, 1000);
            updateTrayMenu();
            try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', { running: true, elapsed: Date.now() - timerStart!, description: timerDescription })); } catch (e) {}
            return { running: true };
        }
        timerDescription = description || '';
        // timerDestination may have been set from args above
        timerStart = Date.now();
        ensureTray();
        updateTrayTitle();
        timerInterval = setInterval(updateTrayTitle, 1000);
        // Refresh tray menu
        updateTrayMenu();
        try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', { running: true, elapsed: 0, description: timerDescription })); } catch (e) {}
        return { running: true };
    }
});

// Toggle pause/resume without stopping/recording
ipcMain.handle('toggle-pause-timer', async (_event, description?: string, destination?: 'Inbox' | 'Daily Note') => {
    if (destination) timerDestination = destination;
    if (description) timerDescription = description;
    if (timerInterval) {
        // currently running -> pause
        if (timerInterval) {
            clearInterval(timerInterval as NodeJS.Timeout);
            timerInterval = null;
        }
        if (timerStart !== null) {
            timerPausedElapsed += Date.now() - timerStart;
        }
        timerStart = null;
        timerPaused = true;
        // Update tray to show paused
        updateTrayTitle();
        try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', { running: false, paused: true, elapsed: timerPausedElapsed, description: timerDescription })); } catch (e) {}
        return { paused: true };
    } else if (timerPaused) {
        // resume from paused
        timerStart = Date.now() - timerPausedElapsed;
        timerPaused = false;
        timerPausedElapsed = 0;
        ensureTray();
        updateTrayTitle();
        timerInterval = setInterval(updateTrayTitle, 1000);
        updateTrayMenu();
        try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', { running: true, elapsed: Date.now() - timerStart!, description: timerDescription })); } catch (e) {}
        return { paused: false };
    }
    // neither running nor paused -> nothing to pause/resume
    // Return paused:false to indicate no pause state changed.
    return { paused: false };
});

ipcMain.handle('get-timer-state', async () => {
    if (timerStart === null) {
        // Not currently running: report paused flag and paused elapsed if applicable
        return { running: false, paused: !!timerPaused, elapsed: timerPaused ? timerPausedElapsed : undefined, description: timerDescription };
    }
    return { running: true, elapsed: Date.now() - timerStart!, description: timerDescription, paused: false };
});

// Get active browser tab (macOS) for Google Chrome using AppleScript
ipcMain.handle('get-active-browser-tab', async () => {
    return new Promise((resolve) => {
        // AppleScript to get active tab's title and URL from Google Chrome
        const script = `tell application \"Google Chrome\"\n if it is running then\n  set w to front window\n  set t to title of active tab of w\n  set u to URL of active tab of w\n  return t & "\n" & u\n else\n  return ""\n end if\nend tell`;

        exec(`osascript -e '${script.replace(/'/g, "\\'")}'`, { timeout: 2000 }, (error, stdout) => {
            if (error) {
                resolve({ success: false, error: error.message });
                return;
            }
            const out = String(stdout || '').trim();
            if (!out) {
                resolve({ success: false, error: 'No active Chrome tab or Chrome is not running' });
                return;
            }
            const [title, url] = out.split('\n');
            resolve({ success: true, title: title || '', url: url || '' });
        });
    });
});

ipcMain.on('lock-auto-hide', () => {
    autoHideLocked = true;
});

ipcMain.on('unlock-auto-hide', () => {
    autoHideLocked = false;
});

app.whenReady().then(async () => {
    await loadSettings();
    createWindow();
    // Ensure the tray icon is created immediately when the app is ready so it shows in the menu bar
    try {
        ensureTray();
    } catch (e) {
        console.error('Failed to create tray on startup', e);
    }

    // Register Global Shortcut
    const ret = globalShortcut.register('Control+Space', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    if (!ret) {
        console.error('Registration failed');
    }

    // Hide dock icon for background app feel
    if (app.dock) {
        app.dock.hide();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    // Do not quit on macOS
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

