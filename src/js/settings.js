// Settings and Preferences Manager

const Settings = {
    prefs: {
        theme: 'dark'
    },
    
    async init() {
        console.log("Settings Initialized");
        await this.loadSettings();
        this.applyTheme();
    },

    async loadSettings() {
        if (!window.TauriBridge) return;
        
        try {
            // Local storage fallback - later we will use tauri-plugin-store or custom FS JSON
            const saved = window.localStorage.getItem('ogmadesk_settings');
            if (saved) {
                this.prefs = JSON.parse(saved);
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    },

    async saveSettings() {
        try {
            window.localStorage.setItem('ogmadesk_settings', JSON.stringify(this.prefs));
            console.log("Settings saved");
        } catch (e) {
            console.error("Failed to save settings", e);
        }
    },

    setTheme(theme) {
        this.prefs.theme = theme;
        this.applyTheme();
        this.saveSettings();
    },

    applyTheme() {
        // App is styled primarily in dark mode. 
        // This provides hooks for future tailwind light/dark inversion class
        if (this.prefs.theme === 'light') {
            document.body.classList.add('theme-light');
            document.body.classList.remove('bg-zinc-900', 'text-zinc-100'); // example overrides
        } else {
            document.body.classList.remove('theme-light');
            document.body.classList.add('bg-zinc-900', 'text-zinc-100');
        }
    }
};

window.Settings = Settings;
