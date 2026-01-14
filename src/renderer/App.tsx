import React, { useState, useRef, useEffect } from 'react';

const App: React.FC = () => {
    const [route, setRoute] = useState(window.location.hash);

    // Apply persisted theme on startup
    useEffect(() => {
        let mql: MediaQueryList | null = null;
        let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

        const applyTheme = (theme: 'dark' | 'light' | 'system') => {
            if (theme === 'system') {
                // match the OS preference
                const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
                document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark';
            } else {
                document.documentElement.dataset.theme = theme;
            }
        };

        const setup = async () => {
            try {
                const settings = await window.api.getSettings();
                const theme = settings.theme ?? 'system';
                applyTheme(theme);

                // If system, listen for changes
                if (theme === 'system' && window.matchMedia) {
                    mql = window.matchMedia('(prefers-color-scheme: light)');
                    mqlHandler = (e: MediaQueryListEvent) => {
                        document.documentElement.dataset.theme = e.matches ? 'light' : 'dark';
                    };
                    // modern API
                    if (mql.addEventListener) mql.addEventListener('change', mqlHandler as EventListener);
                    // fallback older API
                    else if ((mql as any).addListener) (mql as any).addListener(mqlHandler);
                }
            } catch (err) {
                console.warn('Could not load settings for theme', err);
            }
        };

        setup();

        return () => {
            if (mql && mqlHandler) {
                if (mql.removeEventListener) mql.removeEventListener('change', mqlHandler as EventListener);
                else if ((mql as any).removeListener) (mql as any).removeListener(mqlHandler);
            }
        };
    }, []);

    // Listen for settings updates broadcasted by main (so theme changes propagate without restart)
    useEffect(() => {
        const unsub = window.api.onSettingsUpdated((s) => {
            const theme = s.theme ?? 'system';
            if (theme === 'system') {
                const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
                document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark';
            } else {
                document.documentElement.dataset.theme = theme;
            }
        });

        return () => {
            try { unsub(); } catch (e) {}
        };
    }, []);

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
    const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('system');
    const [maxLines, setMaxLines] = useState<number>(10);
    const [outputs, setOutputs] = useState<Array<{ name: string; path: string; id?: 'inbox' | 'daily-note' }>>([]);
    const [geminiApiKey, setGeminiApiKey] = useState<string>('');
    const [vaults, setVaults] = useState<{ name: string; path: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            const [settings, availableVaults] = await Promise.all([
                window.api.getSettings(),
                window.api.listVaults()
            ]);
            setVaultPath(settings.vaultPath);
            setTheme(settings.theme ?? 'system');
            setMaxLines(typeof (settings as any).maxLines === 'number' ? (settings as any).maxLines : 10);
            setOutputs(Array.isArray((settings as any).outputs) ? (settings as any).outputs : []);
            setGeminiApiKey(typeof (settings as any).geminiApiKey === 'string' ? (settings as any).geminiApiKey : '');
            setVaults(availableVaults);
            setIsLoading(false);
        };
        fetchData();
    }, []);

    // Apply selected theme immediately so users see changes before saving
    useEffect(() => {
        let mql: MediaQueryList | null = null;
        let handler: ((e: MediaQueryListEvent) => void) | null = null;

        const apply = (t: 'dark' | 'light' | 'system') => {
            if (t === 'system') {
                const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
                document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark';
                if (window.matchMedia) {
                    mql = window.matchMedia('(prefers-color-scheme: light)');
                    handler = (e: MediaQueryListEvent) => {
                        document.documentElement.dataset.theme = e.matches ? 'light' : 'dark';
                    };
                    if (mql.addEventListener) mql.addEventListener('change', handler as EventListener);
                    else if ((mql as any).addListener) (mql as any).addListener(handler);
                }
            } else {
                document.documentElement.dataset.theme = t;
            }
        };

        apply(theme);

        return () => {
            if (mql && handler) {
                if (mql.removeEventListener) mql.removeEventListener('change', handler as EventListener);
                else if ((mql as any).removeListener) (mql as any).removeListener(handler);
            }
        };
    }, [theme]);

    // Keyboard shortcuts: Enter to save (unless Shift+Enter), Escape to save+exit
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                // Save and close
                (async () => {
                    await window.api.updateSettings({ ...( { vaultPath: vaultPath, theme, maxLines, outputs, geminiApiKey } as any ) });
                    window.close();
                })();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                // Don't trigger when focus is in a textarea (to allow newline)
                const active = document.activeElement;
                if (active && active.tagName === 'TEXTAREA') return;
                e.preventDefault();
                // Save settings immediately and close
                (async () => {
                    await window.api.updateSettings({ ...( { vaultPath: vaultPath, theme, maxLines, outputs, geminiApiKey } as any ) });
                    window.close();
                })();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [vaultPath, theme, maxLines, outputs, geminiApiKey]);


    const pageRef = useRef<HTMLDivElement | null>(null);
    const resizeTimeout = useRef<number | null>(null);

    useEffect(() => {
        if (!pageRef.current) return;

        const sendHeight = () => {
            const el = pageRef.current!;
            // compute the total height including paddings
            const style = window.getComputedStyle(el);
            const paddingTop = parseFloat(style.paddingTop || '0');
            const paddingBottom = parseFloat(style.paddingBottom || '0');
            const total = Math.ceil(el.scrollHeight + paddingTop + paddingBottom);
            try {
                window.api.resizeOptionsWindow(total);
            } catch (e) {
                // ignore in non-electron environments
            }
        };

        // Debounced ResizeObserver
        const ro = new ResizeObserver(() => {
            if (resizeTimeout.current) window.clearTimeout(resizeTimeout.current);
            // @ts-ignore - window.setTimeout returns number in browsers
            resizeTimeout.current = window.setTimeout(() => sendHeight(), 80) as unknown as number;
        });

        ro.observe(pageRef.current);
        // send initial height
        sendHeight();

        return () => {
            ro.disconnect();
            if (resizeTimeout.current) window.clearTimeout(resizeTimeout.current);
        };
    }, [isLoading, vaultPath, theme, maxLines, outputs, vaults]);

    if (isLoading) return <div className="options-page" ref={pageRef}>Loading...</div>;

    return (
        <div className="options-page" ref={pageRef}>
            {/* visual background layer that doesn't affect layout/height */}
            <div className="options-bg" aria-hidden="true" />
            <div className="options-header">
                <h1>Settings</h1>
                <button
                    className="options-close"
                    onClick={() => window.close()}
                    aria-label="Close settings"
                    title="Close"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

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

            <div className="settings-group">
                <label htmlFor="theme-select">Theme</label>
                <select
                    id="theme-select"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'system')}
                >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">Match system</option>
                </select>
            </div>

            <div className="settings-group">
                <label htmlFor="max-lines">Max text field lines</label>
                <input
                    id="max-lines"
                    type="number"
                    min={1}
                    max={50}
                    value={maxLines}
                    onChange={(e) => setMaxLines(Math.max(1, Number(e.target.value) || 1))}
                />
            </div>

            <div className="settings-group">
                <label htmlFor="gemini-api-key">Gemini 3 API key</label>
                <input
                    id="gemini-api-key"
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="Paste your Gemini API key"
                    autoComplete="off"
                />
                <div className="outputs-help" style={{ marginTop: 8 }}>
                    Used by the “Gemini 3” processor (⌘P).
                </div>
            </div>

            <div className="settings-group">
                <label>Outputs</label>
                <div className="outputs-settings">
                    <div className="outputs-help">
                        Set a name and a <strong>vault-relative</strong> path.
                        {' '}You can use placeholders like <code>yyyy</code>, <code>mm</code>, <code>dd</code>.
                    </div>

                    {outputs.length === 0 && (
                        <div className="outputs-empty">
                            No outputs configured yet. Add one below, or restart the app to get defaults.
                        </div>
                    )}

                    {outputs.map((out, idx) => (
                        <div key={out.id ?? `${out.name}-${idx}`} className="outputs-row">
                            <input
                                type="text"
                                value={out.name}
                                placeholder="Output name (e.g. Inbox)"
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setOutputs(prev => prev.map((o, i) => i === idx ? { ...o, name: v } : o));
                                }}
                            />
                            <input
                                type="text"
                                value={out.path}
                                placeholder="Path in vault (e.g. 0_Inbox/Inbox.md)"
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setOutputs(prev => prev.map((o, i) => i === idx ? { ...o, path: v } : o));
                                }}
                            />
                            <button
                                type="button"
                                className="outputs-remove options-close"
                                title={out.id ? 'Built-in output cannot be removed' : 'Remove output'}
                                aria-label="Remove output"
                                disabled={!!out.id}
                                onClick={() => {
                                    if (out.id) return;
                                    setOutputs(prev => prev.filter((_, i) => i !== idx));
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                    ))}

                    <div className="outputs-actions">
                        <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => setOutputs(prev => [...prev, { name: 'New Output', path: '' }])}
                        >
                            Add output
                        </button>
                        <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => {
                                // restore reasonable defaults (without requiring restart)
                                setOutputs([
                                    { id: 'inbox', name: 'Inbox', path: 'Inbox.md' },
                                    { id: 'daily-note', name: 'Daily Note', path: 'yyyy-mm-dd.md' },
                                ]);
                            }}
                        >
                            Reset to defaults
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CommandBar: React.FC = () => {
    const [text, setText] = useState('');
    const [processingText, setProcessingText] = useState('');
    // in-app timer indicator removed per user request
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [destination, setDestination] = useState<'Inbox' | 'Daily Note'>('Daily Note');
    const [showInsertMenu, setShowInsertMenu] = useState(false);
    const [selectedInsertIndex, setSelectedInsertIndex] = useState(0);
    const cmdPressedRef = useRef(false);
    const [showOutputMenu, setShowOutputMenu] = useState(false);
    const [selectedOutputIndex, setSelectedOutputIndex] = useState(1); // 0 = Inbox, 1 = Daily Note
    const cmdOPressedRef = useRef(false);
    const [showProcessorMenu, setShowProcessorMenu] = useState(false);
    const [selectedProcessorIndex, setSelectedProcessorIndex] = useState(0);
    const cmdPPressedRef = useRef(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [maxLines, setMaxLines] = useState<number>(10);

    // Animated "placeholder" while processing (textarea is disabled, so placeholder won't render)
    useEffect(() => {
        if (!isProcessing) {
            setProcessingText('');
            return;
        }

        const frames = [
            'Processing',
            'Processing.',
            'Processing..',
            'Processing...',
        ];
        let i = 0;
        setProcessingText(frames[i]);
        const id = window.setInterval(() => {
            i = (i + 1) % frames.length;
            setProcessingText(frames[i]);
        }, 250);

        return () => {
            window.clearInterval(id);
        };
    }, [isProcessing]);

    // Auto-resize textarea and window
    useEffect(() => {
        if (textareaRef.current && containerRef.current) {
            const ta = textareaRef.current;
            // reset height to measure scrollHeight
            ta.style.height = 'auto';
            const scrollHeight = ta.scrollHeight;

            // compute approximate line height
            const cs = window.getComputedStyle(ta);
            const lineHeight = parseFloat(cs.lineHeight) || 20; // fallback 20px
            const maxAllowedHeight = Math.max(60, lineHeight * maxLines);

            if (scrollHeight > maxAllowedHeight) {
                ta.style.height = `${maxAllowedHeight}px`;
                ta.style.overflowY = 'auto';
            } else {
                ta.style.height = `${Math.max(60, scrollHeight)}px`;
                ta.style.overflowY = 'hidden';
            }

            // Use requestAnimationFrame to ensure DOM has updated before measuring
            requestAnimationFrame(() => {
                if (containerRef.current) {
                    const totalHeight = containerRef.current.offsetHeight;
                    window.api.resizeWindow(totalHeight);
                }
            });
        }
    }, [text, showInsertMenu, showOutputMenu, showProcessorMenu, selectedProcessorIndex, isProcessing, maxLines]);

    // Close insert menu when clicking outside
    useEffect(() => {
        if (!showInsertMenu) return;
        
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.insert-menu')) {
                setShowInsertMenu(false);
                setSelectedInsertIndex(0);
                cmdPressedRef.current = false;
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showInsertMenu]);

    // Close output menu when clicking outside
    useEffect(() => {
        if (!showOutputMenu) return;
        
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.output-menu') && !target.closest('.destination-text')) {
                setShowOutputMenu(false);
                setSelectedOutputIndex(destination === 'Inbox' ? 0 : 1);
                cmdOPressedRef.current = false;
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showOutputMenu, destination]);

    // Close processor menu when clicking outside
    useEffect(() => {
        if (!showProcessorMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.processor-menu')) {
                setShowProcessorMenu(false);
                setSelectedProcessorIndex(0);
                cmdPPressedRef.current = false;
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showProcessorMenu]);

    // Load maxLines from settings (and keep in sync)
    useEffect(() => {
        const setup = async () => {
            try {
                const settings = await window.api.getSettings();
                setMaxLines(typeof (settings as any).maxLines === 'number' ? (settings as any).maxLines : 10);
            } catch (err) {
                console.warn('Could not load maxLines setting', err);
            }
        };

        setup();

        const unsub = window.api.onSettingsUpdated((s) => {
            setMaxLines(typeof (s as any).maxLines === 'number' ? (s as any).maxLines : 10);
        });

        return () => {
            try { unsub(); } catch (e) {}
        };
    }, []);

    // Global keydown for Cmd+T to toggle timer even when textarea isn't focused
    // Also handle Cmd+I (insert tab) and Cmd+O (cycle destination)
    useEffect(() => {
        const insertMenuItems = ['clipboard', 'browserTab'] as const;
        const outputMenuItems = ['Inbox', 'Daily Note'] as const;
        const processorMenuItems = ['Gemini 3'] as const;
        
        const handler = async (e: KeyboardEvent) => {
            // Cmd+Shift+T => pause (or resume if already paused)
            if ((e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && e.shiftKey) {
                e.preventDefault();
                try {
                    window.api.lockAutoHide();
                    // togglePause will pause if running, resume if paused, or start if none
                    if (window.api.togglePause) {
                        await window.api.togglePause(text, destination);
                    } else {
                        // fallback: try to pause by stopping (best-effort)
                        await window.api.toggleTimer(text, destination);
                    }
                } catch (err) {
                    console.error('Failed to toggle pause for timer', err);
                } finally {
                    window.api.unlockAutoHide();
                }
                return;
            }
            // Cmd+T => start or stop the timer explicitly
            if ((e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                try {
                    window.api.lockAutoHide();
                    // Query state first to decide whether to start or stop
                    let state: any = null;
                    if (window.api.getTimerState) {
                        try { state = await window.api.getTimerState(); } catch { state = null; }
                    }
                    if (state && state.running) {
                        // stop running timer
                        if (window.api.stopTimer) await window.api.stopTimer();
                        else if (window.api.toggleTimer) await window.api.toggleTimer(text, destination);
                    } else if (state && state.paused) {
                        // if paused, end it
                        if (window.api.stopTimer) await window.api.stopTimer();
                        else if (window.api.toggleTimer) await window.api.toggleTimer(text, destination);
                    } else {
                        // start
                        if (window.api.startTimer) await window.api.startTimer(text, destination);
                        else if (window.api.toggleTimer) await window.api.toggleTimer(text, destination);
                    }
                } catch (err) {
                    console.error('Failed to start/stop timer', err);
                } finally {
                    window.api.unlockAutoHide();
                }
            }
            // Cmd+O: show output menu and cycle through options while cmd is held
            if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                
                if (!showOutputMenu) {
                    // First press: show menu with current destination selected
                    // ensure insert menu is closed when opening output menu
                    setShowInsertMenu(false);
                    setSelectedInsertIndex(0);
                    setShowOutputMenu(true);
                    setSelectedOutputIndex(destination === 'Inbox' ? 0 : 1);
                    cmdOPressedRef.current = true;
                } else if (cmdOPressedRef.current) {
                    // Subsequent presses while cmd held: cycle to next option
                    setSelectedOutputIndex((prev) => (prev + 1) % outputMenuItems.length);
                }
            }
            // Cmd+P: show processors menu and cycle through processors while cmd is held
            if ((e.key === 'p' || e.key === 'P') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();

                if (isProcessing) return;

                if (!showProcessorMenu) {
                    // First press: show menu
                    // ensure other menus are closed
                    setShowInsertMenu(false);
                    setSelectedInsertIndex(0);
                    setShowOutputMenu(false);
                    setSelectedOutputIndex(destination === 'Inbox' ? 0 : 1);
                    setShowProcessorMenu(true);
                    setSelectedProcessorIndex(0);
                    cmdPPressedRef.current = true;
                } else if (cmdPPressedRef.current) {
                    // cycle to next
                    setSelectedProcessorIndex((prev) => (prev + 1) % processorMenuItems.length);
                }
            }
            // Cmd+I: show insert menu and cycle through items while cmd is held
            if ((e.key === 'i' || e.key === 'I') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                
                if (!showInsertMenu) {
                    // First press: show menu with first item selected
                    // ensure output menu is closed when opening insert menu
                    setShowOutputMenu(false);
                    setSelectedOutputIndex(destination === 'Inbox' ? 0 : 1);
                    setShowInsertMenu(true);
                    setSelectedInsertIndex(0);
                    cmdPressedRef.current = true;
                } else if (cmdPressedRef.current) {
                    // Subsequent presses while cmd held: cycle to next item
                    setSelectedInsertIndex((prev) => (prev + 1) % insertMenuItems.length);
                }
            }
        };
        
        const keyupHandler = async (e: KeyboardEvent) => {
            // When cmd key is released, trigger the selected item
            if ((e.key === 'Meta' || e.key === 'Control')) {
                if (cmdPressedRef.current && showInsertMenu) {
                    cmdPressedRef.current = false;
                    
                    // Trigger the selected insert item
                    const selectedItem = insertMenuItems[selectedInsertIndex];
                    if (selectedItem === 'clipboard') {
                        await handleInsertClipboard();
                    } else if (selectedItem === 'browserTab') {
                        await handleInsertBrowserTab();
                    }
                }
                
                if (cmdOPressedRef.current && showOutputMenu) {
                    cmdOPressedRef.current = false;
                    
                    // Set the selected output destination
                    const selectedOutput = outputMenuItems[selectedOutputIndex];
                    setDestination(selectedOutput);
                    setShowOutputMenu(false);
                    setSelectedOutputIndex(selectedOutput === 'Inbox' ? 0 : 1);
                    
                    // Return focus to the textarea
                    requestAnimationFrame(() => textareaRef.current?.focus());
                }

                if (cmdPPressedRef.current && showProcessorMenu) {
                    cmdPPressedRef.current = false;

                    const selectedProcessor = processorMenuItems[selectedProcessorIndex];
                    setShowProcessorMenu(false);
                    setSelectedProcessorIndex(0);

                    if (selectedProcessor === 'Gemini 3') {
                        await handleRunProcessor('gemini-3');
                    }

                    requestAnimationFrame(() => textareaRef.current?.focus());
                }
            }
        };
        
        window.addEventListener('keydown', handler);
        window.addEventListener('keyup', keyupHandler);
        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keyup', keyupHandler);
        };
    }, [text, showInsertMenu, selectedInsertIndex, showOutputMenu, selectedOutputIndex, showProcessorMenu, selectedProcessorIndex, destination, isProcessing]);

    const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Handle Tab / Shift+Tab for indentation and inserting a literal tab
        if (e.key === 'Tab') {
            const ta = textareaRef.current;
            if (!ta) return;
            e.preventDefault();

            const val = ta.value;
            const selStart = ta.selectionStart ?? 0;
            const selEnd = ta.selectionEnd ?? selStart;

            // compute the start and end of the affected block (full lines)
            const lineStart = val.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
            // find index after the last line included in selection
            let endLineIndex = val.indexOf('\n', selEnd);
            if (endLineIndex === -1) endLineIndex = val.length; // until EOF
            else endLineIndex = val.indexOf('\n', selEnd) + 1; // include newline

            const block = val.slice(lineStart, selEnd);
            const lines = block.split('\n');

            // Helper to detect list-marker lines like "   - "
            const isListLine = (s: string) => /^\s*-\s/.test(s);

            if (e.shiftKey) {
                // Dedent: for each selected line remove one leading '\t' or up to 4 spaces
                const newLines = lines.map((ln) => {
                    if (ln.startsWith('\t')) return ln.slice(1);
                    if (/^ {1,4}/.test(ln)) return ln.replace(/^ {1,4}/, '');
                    // If no leading indent but it's a list line, try to remove one leading tab before optional whitespace
                    if (isListLine(ln)) return ln.replace(/^\t/, '');
                    return ln;
                });

                const newVal = val.slice(0, lineStart) + newLines.join('\n') + val.slice(selEnd);
                setText(newVal);

                // compute new selection positions
                // count removed characters per line to adjust selection
                let removed = 0;
                for (let i = 0; i < lines.length; i++) {
                    const oldLn = lines[i];
                    const newLn = newLines[i];
                    removed += oldLn.length - newLn.length;
                }

                requestAnimationFrame(() => {
                    ta.focus();
                    // set selection to cover the transformed block
                    ta.setSelectionRange(lineStart, lineStart + newLines.join('\n').length);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            } else {
                // Indent: if multiple lines selected we indent each line; otherwise insert a literal tab at cursor
                if (selStart !== selEnd && lines.length > 1) {
                    const newLines = lines.map((ln) => '\t' + ln);
                    const newVal = val.slice(0, lineStart) + newLines.join('\n') + val.slice(selEnd);
                    setText(newVal);
                    requestAnimationFrame(() => {
                        ta.focus();
                        // place selection around the indented block
                        ta.setSelectionRange(lineStart, lineStart + newLines.join('\n').length);
                        const ev = new Event('input', { bubbles: true });
                        ta.dispatchEvent(ev);
                    });
                } else {
                    // single caret or single-line selection: if current line starts with list marker, indent the whole line
                    const lineEnd = val.indexOf('\n', selStart) === -1 ? val.length : val.indexOf('\n', selStart);
                    const currentLine = val.slice(lineStart, lineEnd);
                    if (isListLine(currentLine)) {
                        const newLine = '\t' + currentLine;
                        const newVal = val.slice(0, lineStart) + newLine + val.slice(lineEnd);
                        setText(newVal);
                        const delta = 1; // inserted one char
                        requestAnimationFrame(() => {
                            ta.focus();
                            const pos = (selStart >= lineStart ? selStart + delta : selStart);
                            ta.setSelectionRange(pos, pos);
                            const ev = new Event('input', { bubbles: true });
                            ta.dispatchEvent(ev);
                        });
                    } else {
                        // plain insert tab at caret (common behavior)
                        const before = val.slice(0, selStart);
                        const after = val.slice(selEnd);
                        const newVal = before + '\t' + after;
                        setText(newVal);
                        requestAnimationFrame(() => {
                            ta.focus();
                            const pos = selStart + 1;
                            ta.setSelectionRange(pos, pos);
                            const ev = new Event('input', { bubbles: true });
                            ta.dispatchEvent(ev);
                        });
                    }
                }
            }

            return;
        }
        // Escape: close insert menu or output menu if open, otherwise hide window
        if (e.key === 'Escape') {
            if (showInsertMenu) {
                e.preventDefault();
                setShowInsertMenu(false);
                setSelectedInsertIndex(0);
                cmdPressedRef.current = false;
                return;
            }
            if (showOutputMenu) {
                e.preventDefault();
                setShowOutputMenu(false);
                setSelectedOutputIndex(destination === 'Inbox' ? 0 : 1);
                cmdOPressedRef.current = false;
                return;
            }
            if (showProcessorMenu) {
                e.preventDefault();
                setShowProcessorMenu(false);
                setSelectedProcessorIndex(0);
                cmdPPressedRef.current = false;
                return;
            }
            window.api.hideWindow();
        }
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
        }
        if ((e.key === 'l' || e.key === 'L') && e.metaKey && e.shiftKey) {
            // Cmd+Shift+L: prefer converting a task prefix '- [ ] ' to a simple '- '
            // Otherwise behave like a toggle for '- '
            e.preventDefault();
            const ta = textareaRef.current;
            if (!ta) return;
            const val = ta.value;
            const selStart = ta.selectionStart ?? 0;
            const selEnd = ta.selectionEnd ?? selStart;
            const lineStart = val.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;

            const taskPrefix = val.slice(lineStart, lineStart + 6);
            if (/^-\s\[[ xX]\]\s/.test(taskPrefix)) {
                // replace '- [ ] ' (6 chars) with '- ' (2 chars)
                const newVal = val.slice(0, lineStart) + '- ' + val.slice(lineStart + 6);
                setText(newVal);
                const delta = -4; // net -4 chars
                const newSelStart = Math.max(lineStart, selStart + delta);
                const newSelEnd = Math.max(lineStart, selEnd + delta);
                requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(newSelStart, newSelEnd);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            } else if (val.slice(lineStart, lineStart + 2) === '- ') {
                // existing simple prefix -> remove it (toggle off)
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
                // add simple '- ' prefix
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
        } else if ((e.key === 'l' || e.key === 'L') && e.metaKey && !e.shiftKey) {
            // Cmd+L: if the line has a simple '- ' prefix, replace it with '- [ ] '
            // If it already has a task prefix, remove it (toggle off). Otherwise add '- [ ] '.
            e.preventDefault();
            const ta = textareaRef.current;
            if (!ta) return;
            const val = ta.value;
            const selStart = ta.selectionStart ?? 0;
            const selEnd = ta.selectionEnd ?? selStart;
            const lineStart = val.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
            const taskPrefix = val.slice(lineStart, lineStart + 6);
            if (/^-\s\[[ xX]\]\s/.test(taskPrefix)) {
                // remove task prefix
                const newVal = val.slice(0, lineStart) + val.slice(lineStart + 6);
                setText(newVal);
                const delta = -6;
                const newSelStart = Math.max(lineStart, selStart + delta);
                const newSelEnd = Math.max(lineStart, selEnd + delta);
                requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(newSelStart, newSelEnd);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            } else if (val.slice(lineStart, lineStart + 2) === '- ') {
                // replace simple '- ' with '- [ ] '
                const newVal = val.slice(0, lineStart) + '- [ ] ' + val.slice(lineStart + 2);
                setText(newVal);
                const delta = 4; // replacing 2 chars with 6 chars
                const newSelStart = selStart >= lineStart ? selStart + delta : selStart;
                const newSelEnd = selEnd >= lineStart ? selEnd + delta : selEnd;
                requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(newSelStart, newSelEnd);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            } else {
                // add unchecked task prefix
                const newVal = val.slice(0, lineStart) + '- [ ] ' + val.slice(lineStart);
                setText(newVal);
                const delta = 6;
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

    const handleRunProcessor = async (processorId: 'gemini-3') => {
        try {
            if (!text.trim()) return;
            setIsProcessing(true);

            const res = await (window.api as any).runProcessor(processorId, text);
            if (res && res.success) {
                setText(typeof res.output === 'string' ? res.output : '');
                // Put cursor at end of output
                requestAnimationFrame(() => {
                    const ta = textareaRef.current;
                    if (!ta) return;
                    const pos = ta.value.length;
                    ta.focus();
                    ta.setSelectionRange(pos, pos);
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                });
            } else {
                console.error('Processor failed:', res?.error);
            }
        } catch (err) {
            console.error('Failed to run processor', err);
        } finally {
            setIsProcessing(false);
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

    const handleOutputSelect = (newDestination: 'Inbox' | 'Daily Note') => {
        setDestination(newDestination);
        setShowOutputMenu(false);
        setSelectedOutputIndex(newDestination === 'Inbox' ? 0 : 1);
        cmdOPressedRef.current = false;
        // Return focus to the textarea
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
        });
    };

    const handleInsertBrowserTab = async () => {
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
        } finally {
            setShowInsertMenu(false);
            setSelectedInsertIndex(0);
            cmdPressedRef.current = false;
        }
    };

    const handleInsertClipboard = async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            if (clipboardText) {
                const ta = textareaRef.current;
                if (ta) {
                    // Insert at current cursor position
                    const start = ta.selectionStart ?? ta.value.length;
                    const end = ta.selectionEnd ?? start;
                    const before = ta.value.slice(0, start);
                    const after = ta.value.slice(end);
                    const newValue = before + clipboardText + after;
                    setText(newValue);
                    // Update cursor position to after inserted text
                    requestAnimationFrame(() => {
                        ta.focus();
                        const pos = start + clipboardText.length;
                        ta.setSelectionRange(pos, pos);
                        // trigger resize effect
                        const ev = new Event('input', { bubbles: true });
                        ta.dispatchEvent(ev);
                    });
                } else {
                    // If no textarea, just append
                    setText((t) => (t ? t + '\n' + clipboardText : clipboardText));
                }
            }
        } catch (err) {
            console.error('Failed to read clipboard', err);
        } finally {
            setShowInsertMenu(false);
            setSelectedInsertIndex(0);
            cmdPressedRef.current = false;
        }
    };

    return (
        <div className="command-bar" ref={containerRef}>
            <textarea
                ref={textareaRef}
                className={isProcessing ? 'is-processing' : undefined}
                value={isProcessing ? processingText : text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type to capture..."
                autoFocus
                disabled={isProcessing}
                rows={1}
            />
            {showInsertMenu && (
                <div className="insert-menu">
                    <div className="menu-header">Select an input</div>
                    <div 
                        className={`menu-item ${selectedInsertIndex === 0 ? 'selected' : ''}`}
                        onClick={handleInsertClipboard}
                    >
                        Clipboard
                    </div>
                    <div 
                        className={`menu-item ${selectedInsertIndex === 1 ? 'selected' : ''}`}
                        onClick={handleInsertBrowserTab}
                    >
                        Current tab
                    </div>
                </div>
            )}
            {showOutputMenu && (
                <div className="output-menu">
                    <div className="menu-header">Select an output</div>
                    <div 
                        className={`menu-item ${selectedOutputIndex === 0 ? 'selected' : ''}`}
                        onClick={() => handleOutputSelect('Inbox')}
                    >
                        Inbox
                    </div>
                    <div 
                        className={`menu-item ${selectedOutputIndex === 1 ? 'selected' : ''}`}
                        onClick={() => handleOutputSelect('Daily Note')}
                    >
                        Daily Note
                    </div>
                </div>
            )}
            {showProcessorMenu && (
                <div className="processor-menu">
                    <div className="menu-header">Select a processor</div>
                    <div
                        className={`menu-item ${selectedProcessorIndex === 0 ? 'selected' : ''}`}
                        onClick={() => handleRunProcessor('gemini-3')}
                    >
                        Gemini 3
                    </div>
                </div>
            )}
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
                        <div>Capture to <span 
                            className="destination-text" 
                            onClick={() => {
                                // toggle output menu; ensure insert menu is closed when opening output
                                const willOpen = !showOutputMenu;
                                if (willOpen) {
                                    setShowInsertMenu(false);
                                    setSelectedInsertIndex(0);
                                    setSelectedOutputIndex(destination === 'Inbox' ? 0 : 1);
                                }
                                setShowOutputMenu(willOpen);
                            }}
                        >{destination}</span> with <span 
                            className="key" 
                            onClick={handleSubmit}
                        >↵</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
