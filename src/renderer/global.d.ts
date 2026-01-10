export interface IElectronAPI {
    appendToInbox: (text: string) => Promise<{ success: boolean; error?: string }>;
    appendToDailyNote: (text: string) => Promise<{ success: boolean; error?: string }>;
    hideWindow: () => void;
    resizeWindow: (height: number) => void;
    resizeOptionsWindow: (height: number) => void;
    // theme: 'dark' | 'light' | 'system' - 'system' means match OS preference
    getSettings: () => Promise<{ vaultPath: string; theme?: 'dark' | 'light' | 'system' }>;
    updateSettings: (settings: { vaultPath?: string; theme?: 'dark' | 'light' | 'system' }) => Promise<{ vaultPath: string; theme?: 'dark' | 'light' | 'system' }>;
    onSettingsUpdated: (callback: (settings: { vaultPath?: string; theme?: 'dark' | 'light' | 'system' }) => void) => () => void;
    listVaults: () => Promise<{ name: string; path: string }[]>;
    openOptions: () => void;
    getActiveBrowserTab: () => Promise<{ success: boolean; title?: string; url?: string; error?: string }>;
    toggleTimer: (description: string, destination?: 'Inbox' | 'Daily Note') => Promise<{ running: boolean } | void>;
    startTimer: (description: string, destination?: 'Inbox' | 'Daily Note') => Promise<{ running: true } | void>;
    stopTimer: () => Promise<{ running: false } | void>;
    togglePause: (description?: string, destination?: 'Inbox' | 'Daily Note') => Promise<{ paused: boolean } | void>;
    getTimerState: () => Promise<{ running: boolean; paused?: boolean; elapsed?: number; description?: string } | void>;
    lockAutoHide: () => void;
    unlockAutoHide: () => void;
}

declare global {
    interface Window {
        api: IElectronAPI;
    }
}
