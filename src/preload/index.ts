import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    appendToInbox: (text: string) => ipcRenderer.invoke('append-to-inbox', text),
    appendToDailyNote: (text: string) => ipcRenderer.invoke('append-to-daily-note', text),
    hideWindow: () => ipcRenderer.send('hide-window'),
    resizeWindow: (height: number) => ipcRenderer.send('resize-window', height),
    resizeOptionsWindow: (height: number) => ipcRenderer.send('resize-options-window', height),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
    onSettingsUpdated: (callback: (settings: any) => void) => {
        ipcRenderer.on('settings-updated', (_event, settings) => callback(settings));
        // return an unsubscribe function
        return () => ipcRenderer.removeAllListeners('settings-updated');
    },
    listVaults: () => ipcRenderer.invoke('list-vaults'),
    openOptions: () => ipcRenderer.send('open-options'),
    // Timer controls exposed to renderer
    toggleTimer: (description: string, destination?: 'Inbox' | 'Daily Note') => ipcRenderer.invoke('toggle-timer', description, destination),
    startTimer: (description: string, destination?: 'Inbox' | 'Daily Note') => ipcRenderer.invoke('start-timer', description, destination),
    stopTimer: () => ipcRenderer.invoke('stop-timer'),
    // Timer state queries and subscription
    // Note: getTimerState/onTimerTick removed (no in-app indicator). Timer remains visible in menu bar/tray.
    // Temporarily prevent the main window from auto-hiding (useful around toggle calls)
    lockAutoHide: () => ipcRenderer.send('lock-auto-hide'),
    unlockAutoHide: () => ipcRenderer.send('unlock-auto-hide'),
    // Get active browser tab (title and URL) on macOS (Google Chrome)
    getActiveBrowserTab: () => ipcRenderer.invoke('get-active-browser-tab'),
});
