// Main App Router and logic

const App = {
    currentPage: 'home',
    windowSizeHandlerRegistered: false,

    async init() {
        console.log("OgmaDesk App Initialized");
        
        // Initialize Sidebar
        if (window.Sidebar) {
            Sidebar.init();
        }

        // Initialize Settings
        if (window.Settings) {
            Settings.init();
        }

        // Initialize Workspace System
        if (window.WorkspaceManager) {
            await window.WorkspaceManager.init();
        } else {
            // Load default page if no WorkspaceManager
            this.loadPage('home');
        }

        // Initialize Window Size Persistence
        await this.initWindowSize();
    },

    async initWindowSize() {
        let saveTimeout = null;

        // Restore saved window size
        if (window.TauriBridge?.store && window.TauriBridge?.window) {
            try {
                const savedWidth = await window.TauriBridge.store.get('windowWidth');
                const savedHeight = await window.TauriBridge.store.get('windowHeight');

                if (savedWidth && savedHeight) {
                    await window.TauriBridge.window.setSize(parseInt(savedWidth), parseInt(savedHeight));
                    await window.TauriBridge.window.center();
                }
            } catch (e) {
                console.warn('[App] Could not restore window size:', e);
            }
        }

        // Listen for window resize and save size
        if (!this.windowSizeHandlerRegistered && window.TauriBridge?.window && window.TauriBridge?.store) {
            this.windowSizeHandlerRegistered = true;
            try {
                const appWindow = await window.TauriBridge.window.getCurrent();
                if (appWindow && appWindow.onResized) {
                    const unlisten = await appWindow.onResized(async () => {
                        // Debounce saves
                        if (saveTimeout) clearTimeout(saveTimeout);
                        saveTimeout = setTimeout(async () => {
                            try {
                                const size = await window.TauriBridge.window.getSize();
                                await window.TauriBridge.store.set('windowWidth', size.width);
                                await window.TauriBridge.store.set('windowHeight', size.height);
                            } catch (e) {
                                console.warn('[App] Could not auto-save window size:', e);
                            }
                        }, 500);
                    });
                }
            } catch (e) {
                console.warn('[App] Could not register resize handler:', e);
            }
        }
    },

    onWorkspaceChanged(isActive) {
        console.log(`UI Workspace State: ${isActive ? 'Active' : 'Inactive'}`);
        this.updateSidebarVisibility(isActive);

        if (window.MarkdownEditor?.updateSaveButtonVisibility) {
            window.MarkdownEditor.updateSaveButtonVisibility();
        }

        // Reset tools to clear state when switching modes/projects
        if (window.PdfMerge?.reset) window.PdfMerge.reset();
        if (window.PdfSplit?.reset) window.PdfSplit.reset();
        if (window.PdfEdit?.reset)  window.PdfEdit.reset();
        if (window.ChartBuilder?.reset) window.ChartBuilder.reset();
        if (window.MarkdownEditor?.reset) window.MarkdownEditor.reset();
    },

    updateSidebarVisibility(isWorkspace) {
        const navItems = document.querySelectorAll('.nav-item[data-page]');
        navItems.forEach(item => {
            const page = item.getAttribute('data-page');
            
            // Tools that require a workspace
            const workspaceOnlyTools = ['file-manager', 'kanban-notes'];
            
            if (workspaceOnlyTools.includes(page)) {
                if (isWorkspace) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            }
        });
    },

    restoreSidebarActiveState() {
        const navItems = document.querySelectorAll('.nav-item[data-page]');
        const currentPage = this.currentPage;
        
        navItems.forEach(item => {
            const page = item.getAttribute('data-page');
            if (page === currentPage) {
                item.classList.add('active');
                item.classList.remove('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
            } else {
                item.classList.remove('active');
                item.classList.add('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
            }
        });
    },

    async loadPage(pageName) {
        // Check for unsaved changes in current tool
        if (this.onBeforePageChange) {
            const canProceed = await this.onBeforePageChange();
            if (!canProceed) {
                this.restoreSidebarActiveState();
                return;
            }
        }

        const container = document.getElementById('main-content');
        if (!container) return;

        // Loading state
        container.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="flex flex-col items-center">
                    <i class="ph ph-spinner-gap animate-spin text-4xl text-amber-500 mb-4"></i>
                    <p class="text-zinc-400">Loading...</p>
                </div>
            </div>
        `;

        try {
            const response = await fetch(`pages/${pageName}.html`);
            if (!response.ok) throw new Error(`Page not found: ${pageName}`);

            const html = await response.text();

            await new Promise(resolve => requestAnimationFrame(resolve));
            container.innerHTML = html;

            // Collect and remove all <script> tags from the injected HTML
            const scripts = Array.from(container.querySelectorAll('script'));
            scripts.forEach(s => s.remove());

            // Execute scripts sequentially so external libraries load before
            // inline initialisation code runs (e.g. CDN libs before pdf-suite.js)
            for (const orig of scripts) {
                // If it's a library script that is already loaded, skip re-injecting it
                if (orig.src && (orig.src.includes('/lib/') || orig.src.includes('lib/'))) {
                    const existing = Array.from(document.querySelectorAll('script')).find(s => s.src === orig.src);
                    if (existing) {
                        console.log(`[App] Skipping already loaded library: ${orig.src}`);
                        continue;
                    }
                }

                await new Promise((resolve) => {
                    const newScript = document.createElement('script');
                    let timeout = null;

                    const done = (isError = false) => {
                        if (timeout) clearTimeout(timeout);
                        if (isError) console.warn(`[App] Failed to load script: ${orig.src}`);
                        resolve();
                    };

                    if (orig.src) {
                        // External script — wait for load/error before continuing
                        newScript.src   = orig.src;
                        newScript.async = false;
                        newScript.onload  = () => done();
                        newScript.onerror = () => done(true);
                        
                        // Failsafe timeout to prevent app hang
                        timeout = setTimeout(() => {
                            console.error(`[App] Script load timed out: ${orig.src}`);
                            done(true);
                        }, 5000);
                    } else {
                        // Inline script — copy text and resolve immediately after append
                        newScript.textContent = orig.textContent;
                    }

                    document.body.appendChild(newScript);

                    if (!orig.src) resolve(); // inline scripts execute synchronously
                });
            }

            // Update current page after successful load
            this.currentPage = pageName;

            // Global drop prevention to ensure dropping images outside textareas doesn't redirect the whole webview page
            window.addEventListener('dragover', e => e.preventDefault(), false);
            window.addEventListener('drop', e => e.preventDefault(), false);
        } catch (error) {
            console.error(error);
            container.innerHTML = `
                <div class="flex items-center justify-center h-full text-center">
                    <div>
                        <i class="ph ph-warning-circle text-4xl text-red-500 mb-4"></i>
                        <h2 class="text-xl font-semibold mb-2 text-white">Error Loading Tool</h2>
                        <p class="text-zinc-400">Could not load the requested feature.</p>
                        <p class="text-xs text-zinc-500 mt-4">${error.message}</p>
                    </div>
                </div>
            `;
        }
    },

    /**
     * Show a global toast notification
     * @param {string} message 
     * @param {'success'|'error'|'info'} type 
     */
    showToast(message, type = 'info') {
        const existing = document.getElementById('global-toast-container');
        if (existing) existing.remove();

        const colorMap = {
            success: 'bg-emerald-600/90 border-emerald-500/40',
            error:   'bg-red-700/90 border-red-600/40',
            info:    'bg-zinc-700/90 border-zinc-600/40',
        };
        const iconMap  = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info' };

        const el = document.createElement('div');
        el.id = 'global-toast-container';
        el.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm text-white text-sm font-medium animate-[fade-enter_300ms_ease_out] ${colorMap[type] || colorMap.info}`;
        
        // Escape message to prevent XSS
        const safeMessage = String(message).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        
        el.innerHTML = `<i class="ph ${iconMap[type] || iconMap.info} text-lg"></i><span>${safeMessage}</span>`;
        document.body.appendChild(el);
        
        setTimeout(() => {
            el.classList.add('opacity-0', 'translate-y-2', 'transition-all', 'duration-300');
            setTimeout(() => el.remove(), 300);
        }, 4000);
    }
};

window.App = App;

// Run App on DOM load
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
