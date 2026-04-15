/**
 * Workspace Management System
 * Handles creation, opening, and switching of project workspaces.
 */

const WorkspaceManager = {
    current: null, // { name, path } or null for Quick Mode
    recent: [],    // Array of { name, path }
    
    async init() {
        console.log("Workspace Manager Initialized");
        
        // Load recent workspaces, last used, and last mode
        const savedRecent = await window.TauriBridge.store.get('recentWorkspaces');
        this.recent = savedRecent ? JSON.parse(savedRecent) : [];
        
        const lastMode = await window.TauriBridge.store.get('lastMode');
        const lastWorkspacePath = await window.TauriBridge.store.get('lastWorkspace');
        
        if (lastMode === 'quick') {
            await this.quickMode();
        } else if (lastWorkspacePath) {
            const exists = await window.TauriBridge.fs.exists(lastWorkspacePath);
            if (exists) {
                await this.openWorkspace(lastWorkspacePath);
            } else {
                console.warn("Last workspace not found at:", lastWorkspacePath);
                // Try to find it in recent (even if it doesn't exist, we'll handle it later)
                this.showWorkspaceModal();
            }
        } else {
            this.showWorkspaceModal();
        }
        
        // Background check for existence of all workspaces
        this.checkWorkspacesStatus();

        // Bind UI elements in top bar
        const newBtn = document.getElementById('btn-new-project');
        if (newBtn) {
            newBtn.addEventListener('click', () => this.showWorkspaceModal());
        }

        const closeBtn = document.getElementById('btn-quick-mode');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.quickMode());
        }
    },

    async checkWorkspacesStatus() {
        // Simple check for all recent workspaces to see if they're still there
        for (const ws of this.recent) {
            ws.exists = await window.TauriBridge.fs.exists(ws.path);
        }
        // Save status
        await window.TauriBridge.store.set('recentWorkspaces', JSON.stringify(this.recent));
    },

    showWorkspaceModal() {
        // App will handle showing the modal via route change or overlay
        if (window.App) {
            window.App.loadPage('workspace-modal');
        }
    },

    async createWorkspace(name, rootPath) {
        if (!name || !rootPath) return;
        
        const pathSeparator = rootPath.includes('\\') ? '\\' : '/';
        const workspacePath = `${rootPath}${pathSeparator}${name}`;
        
        try {
            // 1. Create main directory with recursive true
            await window.TauriBridge.fs.mkdir(workspacePath, { recursive: true });
            
            // 2. Create subdirectories
            const subdirs = ['.ogmadesk', 'PDFs', 'Charts', 'Markdown', 'Kanban', 'Assets', 'Files'];
            for (const dir of subdirs) {
                await window.TauriBridge.fs.mkdir(`${workspacePath}${pathSeparator}${dir}`, { recursive: true });
            }
            
            // 3. Create workspace.json metadata
            const metadata = {
                name: name,
                created: new Date().toISOString(),
                version: "1.0"
            };
            await window.TauriBridge.fs.writeTextFile(
                `${workspacePath}${pathSeparator}.ogmadesk${pathSeparator}workspace.json`,
                JSON.stringify(metadata, null, 2)
            );
            
            // 4. Open the workspace
            await this.openWorkspace(workspacePath);
            
        } catch (error) {
            console.error("Failed to create workspace:", error);
            alert(`Error creating workspace: ${error.message || error}\n\nPlease check permissions or if the folder already exists.`);
        }
    },

    async openWorkspace(path) {
        try {
            const exists = await window.TauriBridge.fs.exists(path);
            if (!exists) {
                this.handleMissingWorkspace(path);
                return;
            }

            // Detect name from path
            const name = path.split(/[\\/]/).pop() || path;
            
            this.current = { name, path };
            
            // Update Recent list
            this.addToRecent(name, path);
            
            // Persist
            await window.TauriBridge.store.set('lastMode', 'workspace');
            await window.TauriBridge.store.set('lastWorkspace', path);
            await window.TauriBridge.store.set('recentWorkspaces', JSON.stringify(this.recent));
            
            // Update UI
            this.updateHeaderUI();
            
            // Reset active nav item to Dashboard
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.classList.remove('active');
                item.classList.add('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
                item.classList.remove('text-zinc-100');
            });
            const dashboardItem = document.querySelector('.nav-item[data-page="home"]');
            if (dashboardItem) {
                dashboardItem.classList.add('active');
                dashboardItem.classList.remove('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
            }
            
            // Trigger App Refresh
            if (window.App) {
                window.App.onWorkspaceChanged(true);
                window.App.loadPage('home');
            }
            
            console.log(`Workspace opened: ${name} (${path})`);
        } catch (error) {
            console.error("Error opening workspace:", error);
        }
    },

    async quickMode() {
        this.current = null;
        await window.TauriBridge.store.set('lastMode', 'quick');
        await window.TauriBridge.store.set('lastWorkspace', null);
        
        this.updateHeaderUI();
        
        // Reset active nav item to Dashboard
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
            item.classList.add('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
            item.classList.remove('text-zinc-100');
        });
        const dashboardItem = document.querySelector('.nav-item[data-page="home"]');
        if (dashboardItem) {
            dashboardItem.classList.add('active');
            dashboardItem.classList.remove('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
        }
        
        if (window.App) {
            window.App.onWorkspaceChanged(false);
            window.App.loadPage('home');
        }
    },

    addToRecent(name, path) {
        // Remove if already exists
        this.recent = this.recent.filter(w => w.path !== path);
        // Add to front
        this.recent.unshift({ name, path, exists: true });
        // No limit anymore
    },

    updateHeaderUI() {
        const label = document.getElementById('current-project');
        const closeBtn = document.getElementById('btn-quick-mode');
        
        if (label) {
            if (this.current) {
                label.textContent = this.current.name;
                label.classList.add('text-zinc-200');
                label.classList.remove('text-zinc-400', 'italic');
                label.title = this.current.path;
                if (closeBtn) closeBtn.classList.remove('hidden');
            } else {
                label.textContent = "No Workspace — Quick Mode";
                label.classList.add('text-zinc-400', 'italic');
                label.classList.remove('text-zinc-200');
                label.title = "";
                if (closeBtn) closeBtn.classList.add('hidden');
            }
        }
    },

    handleMissingWorkspace(path) {
        console.error(`Workspace NOT found at: ${path}`);
        // Mark as missing instead of removing it immediately
        this.recent = this.recent.map(w => {
            if (w.path === path) return { ...w, exists: false };
            return w;
        });
        window.TauriBridge.store.set('recentWorkspaces', JSON.stringify(this.recent));
        
        if (this.current && this.current.path === path) {
            alert(`Workspace folder not found at: ${path}. It might have been moved or deleted.`);
            this.showWorkspaceModal();
        }
    },

    async removeWorkspace(path) {
        this.recent = this.recent.filter(w => w.path !== path);
        await window.TauriBridge.store.set('recentWorkspaces', JSON.stringify(this.recent));
    },

    async updateWorkspacePath(oldPath, newPath) {
        // Detect name from path
        const name = newPath.split(/[\\/]/).pop() || newPath;
        this.recent = this.recent.map(w => {
            if (w.path === oldPath) return { ...w, path: newPath, name, exists: true };
            return w;
        });
        await window.TauriBridge.store.set('recentWorkspaces', JSON.stringify(this.recent));
        await this.openWorkspace(newPath);
    }
};

window.WorkspaceManager = WorkspaceManager;
