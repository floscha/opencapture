import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    appendToInbox: (text: string) => ipcRenderer.invoke('append-to-inbox', text),
    hideWindow: () => ipcRenderer.send('hide-window'),
    resizeWindow: (height: number) => ipcRenderer.send('resize-window', height),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
    listVaults: () => ipcRenderer.invoke('list-vaults'),
    openOptions: () => ipcRenderer.send('open-options'),
});
