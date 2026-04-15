/**
 * Kanban Notes — Simplified Multi-Board Implementation
 * Auto-save board name, switch between boards, create/delete boards
 */

var KanbanNotes = (() => {
    let state = {
        boards: [],
        currentBoardId: null,
        sortableInstances: [],
        saveTimeout: null,
        nameSaveTimeout: null
    };

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function getCurrentBoard() {
        return state.boards.find(b => b.id === state.currentBoardId);
    }

    function showToast(message, type = 'info') {
        document.getElementById('kn-toast-container')?.remove();

        const colorMap = {
            success: 'bg-emerald-600/90 border-emerald-500/40',
            error: 'bg-red-700/90 border-red-600/40',
            info: 'bg-zinc-700/90 border-zinc-600/40',
        };
        const iconMap = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info' };

        const el = document.createElement('div');
        el.id = 'kn-toast-container';
        el.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm text-white text-sm font-medium animate-fade-enter ${colorMap[type] || colorMap.info}`;
        el.innerHTML = `<i class="ph ${iconMap[type] || iconMap.info} text-lg"></i><span>${escHtml(message)}</span>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    async function saveBoards() {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return;

        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const kanbanDir = `${workspace.path}${sep}Kanban`;
            await window.TauriBridge.fs.mkdir(kanbanDir, { recursive: true });
            const filePath = `${kanbanDir}${sep}kanban-boards.json`;
            const data = {
                boards: state.boards,
                currentBoardId: state.currentBoardId
            };
            await window.TauriBridge.fs.writeTextFile(filePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[Kanban Notes] save error:', err);
        }
    }

    function debouncedSave() {
        if (state.saveTimeout) clearTimeout(state.saveTimeout);
        state.saveTimeout = setTimeout(() => {
            saveBoards();
        }, 300);
    }

    async function loadBoards() {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return;

        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const filePath = `${workspace.path}${sep}Kanban${sep}kanban-boards.json`;
            const exists = await window.TauriBridge.fs.exists(filePath);
            if (exists) {
                const content = await window.TauriBridge.fs.readTextFile(filePath);
                const data = JSON.parse(content);
                state.boards = data.boards || [];
                state.currentBoardId = data.currentBoardId || null;
            }
        } catch (err) {
            console.log('[Kanban Notes] No saved boards found, using defaults');
        }

        if (state.boards.length === 0) {
            const defaultBoard = createNewBoard('My First Board');
            state.boards.push(defaultBoard);
            state.currentBoardId = defaultBoard.id;
            await saveBoards();
        }

        if (!state.currentBoardId || !state.boards.find(b => b.id === state.currentBoardId)) {
            state.currentBoardId = state.boards[0].id;
        }
    }

    function createNewBoard(name = 'Untitled Board') {
        return {
            id: generateId(),
            name: name,
            columns: [
                { id: 'backlog', title: 'Backlog', cards: [] },
                { id: 'todo', title: 'To Do', cards: [] },
                { id: 'in-progress', title: 'In Progress', cards: [] },
                { id: 'done', title: 'Done', cards: [] }
            ]
        };
    }

    async function createBoard() {
        const newBoard = createNewBoard();
        state.boards.push(newBoard);
        state.currentBoardId = newBoard.id;
        await saveBoards();
        renderBoard();
        renderBoardSelector();
        showToast('New board created', 'success');
    }

    async function deleteBoard(boardId) {
        if (state.boards.length <= 1) {
            showToast('Cannot delete the last board', 'error');
            return;
        }

        const board = state.boards.find(b => b.id === boardId);
        if (!board) return;

        const index = state.boards.findIndex(b => b.id === boardId);
        state.boards.splice(index, 1);

        if (state.currentBoardId === boardId) {
            state.currentBoardId = state.boards[0].id;
        }

        await saveBoards();
        renderBoard();
        renderBoardSelector();
        showToast('Board deleted', 'success');
    }

    async function switchBoard(boardId) {
        state.currentBoardId = boardId;
        await saveBoards();
        renderBoard();
    }

    async function updateBoardName(newName) {
        const board = getCurrentBoard();
        if (!board || !newName.trim()) return;

        board.name = newName.trim();
        await saveBoards();
        renderBoardSelector();
        showToast('Board name saved', 'success');
    }

    function renderBoard() {
        const container = document.getElementById('kn-board');
        if (!container) return;

        const board = getCurrentBoard();
        if (!board) {
            container.innerHTML = '<div class="kn-empty"><i class="ph ph-kanban"></i><p>No board selected</p></div>';
            document.getElementById('kn-board-name').value = '';
            return;
        }

        document.getElementById('kn-board-name').value = board.name;

        container.innerHTML = board.columns.map(col => `
            <div class="kn-column" data-column-id="${col.id}">
                <div class="kn-column-header">
                    <span class="kn-column-title">${escHtml(col.title)}</span>
                    <span class="kn-column-count">${col.cards.length}</span>
                </div>
                <div class="kn-column-content" data-column-id="${col.id}">
                    ${col.cards.map(card => renderCard(card)).join('')}
                </div>
            </div>
        `).join('');

        requestAnimationFrame(() => {
            setTimeout(() => {
                initSortable();
                bindCardEvents();
            }, 10);
        });
    }

    function renderBoardSelector() {
        const select = document.getElementById('kn-board-select');
        const currentId = state.currentBoardId;
        
        select.innerHTML = state.boards.map(board => 
            `<option value="${board.id}" ${board.id === currentId ? 'selected' : ''}>${escHtml(board.name)}</option>`
        ).join('');
    }

    function renderCard(card) {
        return `
            <div class="kn-card" data-card-id="${card.id}">
                <div class="kn-card-title">${escHtml(card.title)}</div>
                ${card.description ? `<div class="kn-card-desc">${escHtml(card.description)}</div>` : ''}
                <div class="kn-card-actions">
                    <button class="kn-card-edit" data-id="${card.id}" title="Edit">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="kn-card-delete" data-id="${card.id}" title="Delete">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    function initSortable() {
        state.sortableInstances.forEach(s => s.destroy());
        state.sortableInstances = [];

        document.querySelectorAll('.kn-column-content').forEach(el => {
            const sort = new Sortable(el, {
                group: 'kanban',
                animation: 200,
                forceFallback: true,
                fallbackOnBody: true,
                swapThreshold: 0.65,
                draggable: '.kn-card',
                onEnd: handleCardMove
            });
            state.sortableInstances.push(sort);
        });
    }

    function handleCardMove(evt) {
        const cardId = evt.item.dataset.cardId;
        const fromColumnId = evt.from.dataset.columnId;
        const toColumnId = evt.to.dataset.columnId;

        if (!fromColumnId || !toColumnId) return;

        const board = getCurrentBoard();
        if (!board) return;

        const fromCol = board.columns.find(c => c.id === fromColumnId);
        const toCol = board.columns.find(c => c.id === toColumnId);

        if (!fromCol || !toCol) return;

        const cardIndex = fromCol.cards.findIndex(c => c.id === cardId);
        if (cardIndex > -1) {
            const [card] = fromCol.cards.splice(cardIndex, 1);
            card.updatedAt = new Date().toISOString();

            if (fromColumnId === toColumnId) {
                fromCol.cards.splice(evt.newIndex, 0, card);
            } else {
                toCol.cards.splice(evt.newIndex, 0, card);
            }
        }

        renderBoard();
        debouncedSave();
    }

    function showAddModal(columnId = 'backlog') {
        document.getElementById('kn-modal')?.remove();

        const board = getCurrentBoard();
        if (!board) return;

        const modal = document.createElement('div');
        modal.id = 'kn-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-note-blank text-amber-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">New Note</h3>
                    </div>
                    <button id="kn-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    <div>
                        <label class="block text-xs text-zinc-400 mb-1">Title *</label>
                        <input id="kn-input-title" type="text" autocomplete="off" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500" placeholder="Enter title...">
                    </div>
                    <div>
                        <label class="block text-xs text-zinc-400 mb-1">Description (optional)</label>
                        <textarea id="kn-input-desc" rows="3" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500 resize-none" placeholder="Enter description..."></textarea>
                    </div>
                    <div>
                        <label class="block text-xs text-zinc-400 mb-1">Column</label>
                        <select id="kn-input-column" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500">
                            ${board.columns.map(c => `<option value="${c.id}" ${c.id === columnId ? 'selected' : ''}>${c.title}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="flex gap-2 mt-5">
                    <button id="kn-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="kn-btn-save" class="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors">Add Note</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#kn-modal-close').addEventListener('click', close);
        modal.querySelector('#kn-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#kn-btn-save').addEventListener('click', () => {
            const title = document.getElementById('kn-input-title').value.trim();
            const desc = document.getElementById('kn-input-desc').value.trim();
            const colId = document.getElementById('kn-input-column').value;

            if (!title) {
                document.getElementById('kn-input-title').classList.add('border-red-500');
                return;
            }

            addCard(colId, title, desc);
            close();
            showToast('Note added', 'success');
        });

        setTimeout(() => document.getElementById('kn-input-title').focus(), 100);
    }

    function showEditModal(cardId) {
        const board = getCurrentBoard();
        if (!board) return;

        let card = null;
        let column = null;
        for (const col of board.columns) {
            card = col.cards.find(c => c.id === cardId);
            if (card) {
                column = col;
                break;
            }
        }
        if (!card) return;

        document.getElementById('kn-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'kn-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-pencil-simple text-amber-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">Edit Note</h3>
                    </div>
                    <button id="kn-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    <div>
                        <label class="block text-xs text-zinc-400 mb-1">Title *</label>
                        <input id="kn-input-title" type="text" autocomplete="off" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500" value="${escHtml(card.title)}">
                    </div>
                    <div>
                        <label class="block text-xs text-zinc-400 mb-1">Description (optional)</label>
                        <textarea id="kn-input-desc" rows="3" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500 resize-none">${escHtml(card.description || '')}</textarea>
                    </div>
                </div>
                <div class="flex gap-2 mt-5">
                    <button id="kn-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="kn-btn-save" class="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#kn-modal-close').addEventListener('click', close);
        modal.querySelector('#kn-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#kn-btn-save').addEventListener('click', () => {
            const title = document.getElementById('kn-input-title').value.trim();
            const desc = document.getElementById('kn-input-desc').value.trim();

            if (!title) {
                document.getElementById('kn-input-title').classList.add('border-red-500');
                return;
            }

            editCard(cardId, title, desc);
            close();
            showToast('Note updated', 'success');
        });

        setTimeout(() => document.getElementById('kn-input-title').focus(), 100);
    }

    function showDeleteConfirm(cardId) {
        document.getElementById('kn-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'kn-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-90 p-5 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-trash text-red-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">Delete Note</h3>
                    </div>
                    <button id="kn-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <p class="text-zinc-300 text-sm mb-5">Are you sure you want to delete this note? This action cannot be undone.</p>
                <div class="flex gap-2">
                    <button id="kn-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="kn-btn-delete" class="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">Delete</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#kn-modal-close').addEventListener('click', close);
        modal.querySelector('#kn-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#kn-btn-delete').addEventListener('click', () => {
            deleteCard(cardId);
            close();
            showToast('Note deleted', 'success');
        });
    }

    function addCard(columnId, title, description = '') {
        const board = getCurrentBoard();
        if (!board) return;

        const column = board.columns.find(c => c.id === columnId);
        if (!column) return;

        const newCard = {
            id: generateId(),
            title,
            description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        column.cards.push(newCard);
        renderBoard();
        debouncedSave();
    }

    function editCard(cardId, title, description = '') {
        const board = getCurrentBoard();
        if (!board) return;

        for (const column of board.columns) {
            const card = column.cards.find(c => c.id === cardId);
            if (card) {
                card.title = title;
                card.description = description;
                card.updatedAt = new Date().toISOString();
                break;
            }
        }
        renderBoard();
        debouncedSave();
    }

    function deleteCard(cardId) {
        const board = getCurrentBoard();
        if (!board) return;

        for (const column of board.columns) {
            const index = column.cards.findIndex(c => c.id === cardId);
            if (index > -1) {
                column.cards.splice(index, 1);
                break;
            }
        }
        renderBoard();
        debouncedSave();
    }

    async function clearBoard() {
        const board = getCurrentBoard();
        if (!board) return;

        const totalCards = board.columns.reduce((sum, col) => sum + col.cards.length, 0);
        if (totalCards === 0) {
            showToast('Board is already empty', 'info');
            return;
        }

        document.getElementById('kn-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'kn-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-90 p-5 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-trash text-red-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">Clear Board</h3>
                    </div>
                    <button id="kn-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <p class="text-zinc-300 text-sm mb-5">Are you sure you want to delete all ${totalCards} notes? This action cannot be undone.</p>
                <div class="flex gap-2">
                    <button id="kn-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="kn-btn-clear" class="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">Clear All</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#kn-modal-close').addEventListener('click', close);
        modal.querySelector('#kn-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#kn-btn-clear').addEventListener('click', () => {
            const b = getCurrentBoard();
            if (b) {
                b.columns.forEach(col => col.cards = []);
            }
            renderBoard();
            debouncedSave();
            close();
            showToast('Board cleared', 'success');
        });
    }

    function showDeleteBoardConfirm() {
        const board = getCurrentBoard();
        if (!board) return;

        if (state.boards.length <= 1) {
            showToast('Cannot delete the last board', 'error');
            return;
        }

        document.getElementById('kn-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'kn-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-90 p-5 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-trash text-red-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">Delete Board</h3>
                    </div>
                    <button id="kn-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <p class="text-zinc-300 text-sm mb-5">Are you sure you want to delete "<span class="text-amber-400">${escHtml(board.name)}</span>"? This action cannot be undone.</p>
                <div class="flex gap-2">
                    <button id="kn-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="kn-btn-delete" class="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">Delete Board</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#kn-modal-close').addEventListener('click', close);
        modal.querySelector('#kn-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#kn-btn-delete').addEventListener('click', () => {
            deleteBoard(state.currentBoardId);
            close();
        });
    }

    function bindCardEvents() {
        const board = document.getElementById('kn-board');
        if (!board) return;

        board.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.kn-card-edit');
            const deleteBtn = e.target.closest('.kn-card-delete');

            if (editBtn) {
                e.preventDefault();
                e.stopPropagation();
                showEditModal(editBtn.dataset.id);
            } else if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                showDeleteConfirm(deleteBtn.dataset.id);
            }
        });
    }

    function bindEvents() {
        document.getElementById('kn-btn-new')?.addEventListener('click', () => showAddModal());
        
        document.getElementById('kn-btn-clear')?.addEventListener('click', () => clearBoard());

        document.getElementById('kn-btn-new-board')?.addEventListener('click', () => createBoard());

        document.getElementById('kn-btn-delete-board')?.addEventListener('click', () => showDeleteBoardConfirm());

        document.getElementById('kn-board-select')?.addEventListener('change', (e) => {
            switchBoard(e.target.value);
        });

        document.getElementById('kn-board-name')?.addEventListener('input', (e) => {
            if (state.nameSaveTimeout) clearTimeout(state.nameSaveTimeout);
            state.nameSaveTimeout = setTimeout(() => {
                updateBoardName(e.target.value);
            }, 500);
        });

        document.getElementById('kn-board-name')?.addEventListener('blur', (e) => {
            const board = getCurrentBoard();
            if (board && e.target.value.trim() !== board.name) {
                updateBoardName(e.target.value);
            }
        });
    }

    async function init() {
        await loadBoards();
        renderBoardSelector();
        renderBoard();
        bindEvents();
    }

    return {
        init,
        showAddModal,
        showToast
    };
})();

window.KanbanNotes = KanbanNotes;
