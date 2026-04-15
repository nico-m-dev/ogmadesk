// Sidebar Navigation Logic

const Sidebar = {
    init() {
        this.sidebarEl = document.getElementById('sidebar');
        this.toggleBtn = document.getElementById('toggle-sidebar');
        this.navItems = document.querySelectorAll('.nav-item');
        
        // Load persisted state
        const isCollapsed = localStorage.getItem('ogmadesk_sidebar_collapsed') === 'true';
        if (isCollapsed && this.sidebarEl) {
            this.sidebarEl.classList.add('collapsed');
        }

        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => this.toggle());
        }

        if (this.navItems) {
            this.navItems.forEach(item => {
                item.addEventListener('click', (e) => this.navigate(e, item));
            });
        }
    },

    toggle() {
        if (!this.sidebarEl) return;
        const isCurrentlyCollapsed = this.sidebarEl.classList.toggle('collapsed');
        localStorage.setItem('ogmadesk_sidebar_collapsed', isCurrentlyCollapsed);
    },

    navigate(e, activeItem) {
        e.preventDefault();
        
        // Update active classes
        this.navItems.forEach(item => {
            item.classList.remove('active');
            
            // Re-add hover and text-zinc-400 styles to inactive tabs
            item.classList.add('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
            item.classList.remove('text-zinc-100'); // Remove absolute white text class just in case
        });
        
        // Set active item styles
        activeItem.classList.add('active');
        activeItem.classList.remove('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
        
        // Load the page
        const page = activeItem.getAttribute('data-page');
        if (page && window.App) {
            window.App.loadPage(page);
        }
    }
};

window.Sidebar = Sidebar;
