import { app, BrowserWindow, globalShortcut, ipcMain, Tray, nativeImage, Menu } from 'electron';
import { join } from 'path';
import { promises as fs } from 'fs';
import { homedir } from 'os';

// Path constants
const OBSIDIAN_DOCUMENTS_PATH = join(homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents');
const SETTINGS_FILE_PATH = join(app.getPath('userData'), 'settings.json');

interface Settings {
    vaultPath: string;
}

const getInitialSettings = (): Settings => ({
    vaultPath: ''
});

let settings: Settings = getInitialSettings();
let mainWindow: BrowserWindow | null = null;
let optionsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let timerInterval: NodeJS.Timeout | null = null;
let timerStart: number | null = null; // epoch ms when timer started
let timerDescription = '';
let timerDestination: 'Inbox' | 'Daily Note' | null = null;
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
        width: 400,
        height: 300,
        show: false, // Start hidden to prevent flash
        title: 'OpenCapture Options',
        backgroundColor: '#1a1b1e', // Match app background
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
        optionsWindow?.show();
    });

    optionsWindow.on('closed', () => {
        optionsWindow = null;
    });
};
// IPC Handlers
ipcMain.handle('append-to-inbox', async (_event, text: string) => {
    try {
        if (!settings.vaultPath) {
            throw new Error('No vault selected. Please go to settings.');
        }
        const inboxFile = join(settings.vaultPath, 'Inbox/Inbox.md');
        const contentToAppend = `\n${text}`;

        // Ensure directory exists (optional, but safer)
        const dir = join(settings.vaultPath, 'Inbox');
        await fs.mkdir(dir, { recursive: true });

        await fs.appendFile(inboxFile, contentToAppend, 'utf8');
        return { success: true };
    } catch (error) {
        console.error('Failed to append to file:', error);
        return { success: false, error: (error as Error).message };
    }
});

ipcMain.handle('append-to-daily-note', async (_event, text: string) => {
    try {
        if (!settings.vaultPath) {
            throw new Error('No vault selected. Please go to settings.');
        }

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const calendarDir = join(settings.vaultPath, 'Calendar');
        const dailyFile = join(calendarDir, `${yyyy}-${mm}-${dd}.md`);

        // Ensure directory exists
        await fs.mkdir(calendarDir, { recursive: true });

        const contentToAppend = `\n${text}`;
        await fs.appendFile(dailyFile, contentToAppend, 'utf8');
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

// Timer helpers
function ensureTray() {
    if (tray) return;
    // Create a minimal empty image for tray icon so only title shows
    const img = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=');
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
                if (!settings.vaultPath) throw new Error('No vault selected');
                const inboxDir = join(settings.vaultPath, 'Inbox');
                const inboxFile = join(inboxDir, 'Inbox.md');
                await fs.mkdir(inboxDir, { recursive: true });
                await fs.appendFile(inboxFile, line, 'utf8');
            } else if (recordedDestination === 'Daily Note') {
                if (!settings.vaultPath) throw new Error('No vault selected');
                const now = new Date();
                const yyyy = now.getFullYear();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const calendarDir = join(settings.vaultPath, 'Calendar');
                const dailyFile = join(calendarDir, `${yyyy}-${mm}-${dd}.md`);
                await fs.mkdir(calendarDir, { recursive: true });
                await fs.appendFile(dailyFile, line, 'utf8');
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
    if (!tray || timerStart === null) return;
    const elapsed = Date.now() - timerStart;
    const timeStr = formatElapsed(elapsed);
    const title = `${timeStr} - ${timerDescription}`;
    // setTitle works on macOS to show text in status bar
    try {
        tray.setTitle(title);
    } catch (e) {
        // Some platforms may not support setTitle; ignore
    }
    // Broadcast timer tick to renderer windows
    try {
        const state = { running: true, elapsed, description: timerDescription };
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
    timerStart = Date.now();
    // If destination provided via args, it will be set by caller; otherwise keep existing
    ensureTray();
    updateTrayTitle();
    timerInterval = setInterval(updateTrayTitle, 1000);
    return { running: true };
});

ipcMain.handle('stop-timer', async () => {
    await stopTimerLogic();
    return { running: false };
});

ipcMain.handle('toggle-timer', async (_event, description: string, destination?: 'Inbox' | 'Daily Note') => {
    if (destination) timerDestination = destination;
    if (timerInterval) {
        // stop
        if (timerInterval) {
            clearInterval(timerInterval as NodeJS.Timeout);
            timerInterval = null;
        }
    timerStart = null;
    timerDescription = '';
    // clear destination
    timerDestination = null;
        if (tray) {
            try { tray.setTitle(''); } catch (e) {}
        }
        try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('timer-tick', { running: false })); } catch (e) {}
        return { running: false };
    } else {
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

ipcMain.handle('get-timer-state', async () => {
    if (timerStart === null) {
        return { running: false };
    }
    return { running: true, elapsed: Date.now() - timerStart!, description: timerDescription };
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

