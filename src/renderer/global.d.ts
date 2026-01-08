export interface IElectronAPI {
    appendToInbox: (text: string) => Promise<{ success: boolean; error?: string }>;
    appendToDailyNote: (text: string) => Promise<{ success: boolean; error?: string }>;
    hideWindow: () => void;
    resizeWindow: (height: number) => void;
    getSettings: () => Promise<{ vaultPath: string }>;
    updateSettings: (settings: { vaultPath: string }) => Promise<{ vaultPath: string }>;
    listVaults: () => Promise<{ name: string; path: string }[]>;
    openOptions: () => void;
    toggleTimer: (description: string, destination?: 'Inbox' | 'Daily Note') => Promise<{ running: boolean } | void>;
    startTimer: (description: string, destination?: 'Inbox' | 'Daily Note') => Promise<{ running: true } | void>;
    stopTimer: () => Promise<{ running: false } | void>;
    lockAutoHide: () => void;
    unlockAutoHide: () => void;
}

declare global {
    interface Window {
        api: IElectronAPI;
    }
}
