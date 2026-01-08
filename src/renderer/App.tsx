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
    // in-app timer indicator removed per user request
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [destination, setDestination] = useState<'Inbox' | 'Daily Note'>('Daily Note');

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

    // Global keydown for Cmd+T to toggle timer even when textarea isn't focused
    // Also handle Cmd+I (insert tab) and Cmd+O (cycle destination)
    useEffect(() => {
        const handler = async (e: KeyboardEvent) => {
            if ((e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                try {
                        window.api.lockAutoHide();
                        await window.api.toggleTimer(text, destination);
                } catch (err) {
                    console.error('Failed to toggle timer', err);
                } finally {
                    window.api.unlockAutoHide();
                }
            }
            // Cmd+O: cycle destination between Inbox and Daily Note
            if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                setDestination((prev) => (prev === 'Inbox' ? 'Daily Note' : 'Inbox'));
                // Return focus to the textarea
                requestAnimationFrame(() => textareaRef.current?.focus());
            }
            // Cmd+I: insert active Chrome tab as markdown link at cursor
            if ((e.key === 'i' || e.key === 'I') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                try {
                    // Ask main for active browser tab info
                    const res = await window.api.getActiveBrowserTab();
                    if (res && res.success && res.title && res.url) {
                        const markdown = `[${res.title}](${res.url})`;
                        // Insert at current cursor position in textarea if possible
                        const ta = textareaRef.current;
                        if (ta) {
                            // Remember current selection
                            const start = ta.selectionStart ?? ta.value.length;
                            const end = ta.selectionEnd ?? start;
                            const before = ta.value.slice(0, start);
                            const after = ta.value.slice(end);
                            const newValue = before + markdown + after;
                            setText(newValue);
                            // Update cursor position to after inserted markdown
                            requestAnimationFrame(() => {
                                ta.focus();
                                const pos = start + markdown.length;
                                ta.setSelectionRange(pos, pos);
                                // trigger resize effect
                                const ev = new Event('input', { bubbles: true });
                                ta.dispatchEvent(ev);
                            });
                        } else {
                            // If no textarea, just append
                            setText((t) => (t ? t + '\n' + markdown : markdown));
                        }
                    } else {
                        console.warn('Could not get active browser tab:', res?.error);
                    }
                } catch (err) {
                    console.error('Failed to fetch active browser tab', err);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [text]);

    const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter should capture. Shift+Enter should insert a newline.
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                // allow default behavior (inserting a newline)
                return;
            }
            // For Enter without Shift, treat as submit. Also allow Cmd/Ctrl+Enter for accessibility.
            if (e.metaKey || e.ctrlKey || !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                await handleSubmit();
            }
        } else if (e.key === 'Escape') {
            window.api.hideWindow();
        } else if ((e.key === 'l' || e.key === 'L') && e.metaKey && e.shiftKey) {
            // Cmd+Shift+L: toggle '- ' prefix for the current line
            e.preventDefault();
            const ta = textareaRef.current;
            if (!ta) return;
            const val = ta.value;
            const selStart = ta.selectionStart ?? 0;
            const selEnd = ta.selectionEnd ?? selStart;
            const lineStart = val.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;

            if (val.slice(lineStart, lineStart + 2) === '- ') {
                // remove prefix
                const newVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
                setText(newVal);
                const delta = -2;
                const newSelStart = Math.max(lineStart, selStart + delta);
                const newSelEnd = Math.max(lineStart, selEnd + delta);
                requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(newSelStart, newSelEnd);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            } else {
                // add prefix
                const newVal = val.slice(0, lineStart) + '- ' + val.slice(lineStart);
                setText(newVal);
                const delta = 2;
                const newSelStart = selStart >= lineStart ? selStart + delta : selStart;
                const newSelEnd = selEnd >= lineStart ? selEnd + delta : selEnd;
                requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(newSelStart, newSelEnd);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            }
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

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div><span className="key">↵</span> Capture</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
