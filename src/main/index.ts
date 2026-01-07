import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
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
        mainWindow?.hide();
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
