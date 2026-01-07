import React, { useState, useRef, useEffect } from 'react';

const App: React.FC = () => {
    const [route, setRoute] = useState(window.location.hash);

    useEffect(() => {
        const handleHashChange = () => setRoute(window.location.hash);
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    if (route === '#options') {
        return <Options />;
    }

    return <CommandBar />;
};

const Options: React.FC = () => {
    const [vaultPath, setVaultPath] = useState('');
    const [vaults, setVaults] = useState<{ name: string; path: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            const [settings, availableVaults] = await Promise.all([
                window.api.getSettings(),
                window.api.listVaults()
            ]);
            setVaultPath(settings.vaultPath);
            setVaults(availableVaults);
            setIsLoading(false);
        };
        fetchData();
    }, []);

    const handleSave = async () => {
        await window.api.updateSettings({ vaultPath: vaultPath });
        window.close();
    };

    if (isLoading) return <div className="options-page">Loading...</div>;

    return (
        <div className="options-page">
            <h1>Settings</h1>

            <div className="settings-group">
                <label htmlFor="vault-select">Select Obsidian Vault</label>
                <select
                    id="vault-select"
                    value={vaultPath}
                    onChange={(e) => setVaultPath(e.target.value)}
                    autoFocus
                >
                    <option value="" disabled>Select a vault...</option>
                    {vaults.map(vault => (
                        <option key={vault.path} value={vault.path}>
                            {vault.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="button-group">
                <button className="button button-secondary" onClick={() => window.close()}>Cancel</button>
                <button className="button button-primary" onClick={handleSave}>Save</button>
            </div>
        </div>
    );
};

const CommandBar: React.FC = () => {
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [destination, setDestination] = useState<'Inbox' | 'Daily Note'>('Inbox');

    // Auto-resize textarea and window
    useEffect(() => {
        if (textareaRef.current && containerRef.current) {
            textareaRef.current.style.height = 'auto';
            const scrollHeight = textareaRef.current.scrollHeight;
            const newHeight = Math.max(60, scrollHeight);
            textareaRef.current.style.height = `${newHeight}px`;

            const totalHeight = containerRef.current.offsetHeight;
            window.api.resizeWindow(totalHeight);
        }
    }, [text]);

    const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter') {
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                await handleSubmit();
            }
        } else if (e.key === 'Escape') {
            window.api.hideWindow();
        } else if (e.key === ',' && e.metaKey) {
            e.preventDefault();
            window.api.openOptions();
        }
    };

    const handleSubmit = async () => {
        if (!text.trim()) return;

        let result;
        if (destination === 'Inbox') {
            result = await window.api.appendToInbox(text);
        } else {
            result = await window.api.appendToDailyNote(text);
        }

        if (result.success) {
            setText('');
            window.api.hideWindow();
        } else {
            console.error('Failed to append:', result.error);
        }
    };

    const handleDestinationChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setDestination(e.target.value as 'Inbox' | 'Daily Note');
        // Return focus to the textarea after changing destination
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
        });
    };

    return (
        <div className="command-bar" ref={containerRef}>
            <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type to capture..."
                autoFocus
                rows={1}
            />
            <div className="footer">
                <div className="footer-left">
                    <div className="options-container">
                        <button
                            className="options-trigger"
                            onClick={() => window.api.openOptions()}
                            title="Settings (⌘,)"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="footer-right">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select
                            className="destination-select"
                            value={destination}
                            onChange={handleDestinationChange}
                            aria-label="Capture destination"
                        >
                            <option value="Inbox">Inbox</option>
                            <option value="Daily Note">Daily Note</option>
                        </select>

                        <div><span className="key">⌘ ↵</span> Capture</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
