export interface IElectronAPI {
    appendToInbox: (text: string) => Promise<{ success: boolean; error?: string }>;
    hideWindow: () => void;
    resizeWindow: (height: number) => void;
    getSettings: () => Promise<{ vaultPath: string }>;
    updateSettings: (settings: { vaultPath: string }) => Promise<{ vaultPath: string }>;
    listVaults: () => Promise<{ name: string; path: string }[]>;
    openOptions: () => void;
}

declare global {
    interface Window {
        api: IElectronAPI;
    }
}
