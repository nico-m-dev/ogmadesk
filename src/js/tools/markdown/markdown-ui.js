/**
 * Markdown Editor — UI & Formatting
 * Handles syntax insertion, live preview rendering, scrolling, and view toggles.
 * Now enriched with Undo/Redo, drag-and-drop Image logic, and clickable task lists.
 */

var MarkdownUI = (() => {
    let el = {};

    function init() {
        el = {
            textarea: document.getElementById('md-textarea'),
            preview: document.getElementById('md-preview-content'),
            wordCount: document.getElementById('md-word-count'),
            paneEditor: document.getElementById('md-editor-pane'),
            panePreview: document.getElementById('md-preview-pane'),
            
            // Views
            viewEditor: document.getElementById('md-view-editor'),
            viewSplit: document.getElementById('md-view-split'),
            viewPreview: document.getElementById('md-view-preview'),

            // Format Buttons
            fmtBold: document.getElementById('md-fmt-bold'),
            fmtItalic: document.getElementById('md-fmt-italic'),
            fmtStrike: document.getElementById('md-fmt-strikethrough'),
            fmtH1: document.getElementById('md-fmt-h1'),
            fmtH2: document.getElementById('md-fmt-h2'),
            fmtH3: document.getElementById('md-fmt-h3'),
            fmtQuote: document.getElementById('md-fmt-quote'),
            fmtCode: document.getElementById('md-fmt-code'),
            fmtTask: document.getElementById('md-fmt-task'),
            fmtUl: document.getElementById('md-fmt-ul'),
            fmtOl: document.getElementById('md-fmt-ol'),
            fmtLink: document.getElementById('md-fmt-link'),
            fmtUndo: document.getElementById('md-fmt-undo'),
            fmtRedo: document.getElementById('md-fmt-redo'),

            // Image Modal
            imgModal: document.getElementById('md-image-modal'),
            imgClose: document.getElementById('md-img-close'),
            imgUpload: document.getElementById('md-img-upload'),
            imgGallery: document.getElementById('md-img-gallery'),
            imgEmpty: document.getElementById('md-img-empty')
        };

        if (window.marked) {
            marked.setOptions({
                gfm: true,
                breaks: true,
                headerIds: false,
            });
        }

        bindEvents();
        updateToolbarState();
        updatePreview();
    }

    function updateToolbarState() {
        const linkBtn = el.fmtLink;
        if (!linkBtn) return;
        const existingImageBtn = document.getElementById('md-fmt-image');
        if (existingImageBtn) existingImageBtn.remove();

        if (window.WorkspaceManager?.current) {
            const imageBtn = document.createElement('div');
            imageBtn.className = 'md-format-btn';
            imageBtn.id = 'md-fmt-image';
            imageBtn.title = 'Insert Image';
            imageBtn.innerHTML = '<i class="ph ph-image"></i>';
            imageBtn.addEventListener('click', openImageModal);
            linkBtn.after(imageBtn);
        }
    }

    function bindEvents() {
        // Typing
        el.textarea.addEventListener('input', () => {
            updatePreview();
            if (window.MarkdownEditor) window.MarkdownEditor.markDirty();
        });

        el.textarea.addEventListener('keydown', e => {
            if (e.key === 'Tab') {
                e.preventDefault();
                insertAtCursor('    ', '');
            }
        });

        // View Toggles
        el.viewEditor.addEventListener('click', () => setView('editor'));
        el.viewSplit.addEventListener('click', () => setView('split'));
        el.viewPreview.addEventListener('click', () => setView('preview'));

        // Formatting
        el.fmtBold.addEventListener('click', () => insertAtCursor('**', '**', 'bold text'));
        el.fmtItalic.addEventListener('click', () => insertAtCursor('*', '*', 'italic text'));
        el.fmtStrike.addEventListener('click', () => insertAtCursor('~~', '~~', 'strikethrough'));
        
        el.fmtH1.addEventListener('click', () => insertAtLineStart('# '));
        el.fmtH2.addEventListener('click', () => insertAtLineStart('## '));
        el.fmtH3.addEventListener('click', () => insertAtLineStart('### '));
        el.fmtQuote.addEventListener('click', () => insertAtLineStart('> '));
        
        el.fmtTask.addEventListener('click', () => insertAtLineStart('- [ ] '));
        el.fmtUl.addEventListener('click', () => insertAtLineStart('- '));
        el.fmtOl.addEventListener('click', () => insertAtLineStart('1. '));
        
        el.fmtCode.addEventListener('click', () => {
            const hasSelection = el.textarea.selectionStart !== el.textarea.selectionEnd;
            if (hasSelection) {
                insertAtCursor('\`', '\`');
            } else {
                insertAtCursor('\n\`\`\`\n', '\n\`\`\`\n', 'code');
            }
        });
        
        el.fmtLink.addEventListener('click', () => insertAtCursor('[', '](https://...)', 'link text'));
        
        // Undo / Redo
        el.fmtUndo.addEventListener('click', () => document.execCommand('undo'));
        el.fmtRedo.addEventListener('click', () => document.execCommand('redo'));

        // Scroll Sync
        el.textarea.addEventListener('scroll', syncScroll);

        // Preview task clicking
        el.preview.addEventListener('change', e => {
            if (e.target.tagName.toLowerCase() === 'input' && e.target.type === 'checkbox') {
                handleCheckboxClick(e.target);
            }
        });

        // Drag and Drop Images
        el.textarea.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        el.textarea.addEventListener('drop', async e => {
            e.preventDefault();
            // OS file drops in Chromium/Tauri often have empty MIME .type, so we verify by extension!
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.match(/\.(png|jpe?g|gif|webp|svg)$/i));
            if (files.length > 0) {
                insertImageFiles(files);
            }
        });

        // Image Modal logic
        el.imgClose.addEventListener('click', () => { el.imgModal.classList.add('hidden'); });
        el.imgModal.addEventListener('click', e => { if(e.target === el.imgModal) el.imgModal.classList.add('hidden'); });
        
        el.imgUpload.addEventListener('click', async () => {
            el.imgModal.classList.add('hidden');
            const filePath = await window.TauriBridge.dialog.open({
                filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
            });
            if (!filePath) return;

            // read file visually to get name, but actually Tauri needs it to be copied
            // Actually, we can use fs.readFile and writeBinaryFile
            try {
                const bytes = await window.TauriBridge.fs.readFile(filePath);
                const name = filePath.replace(/.*[\\/]/, '');
                const fileObj = new File([bytes], name, { type: 'image/png' }); // mime not critical here
                await insertImageFiles([fileObj]);
            } catch(e) {
                console.error("Failed to insert native image", e);
            }
        });
    }

    /* ------------------------------------------------------------------
     * Checkbox parsing
     * ------------------------------------------------------------------ */
    function handleCheckboxClick(checkbox) {
        // Find which checkbox this is in the preview
        const allCheckboxes = Array.from(el.preview.querySelectorAll('input[type="checkbox"]'));
        const index = allCheckboxes.indexOf(checkbox);
        if (index === -1) return;

        const isChecked = checkbox.checked;
        const text = el.textarea.value;
        const checkboxRegex = /^(\s*-\s+\[)([ xX])(\])/gm;
        
        let matchCount = -1;
        let newText = text.replace(checkboxRegex, (match, p1, p2, p3) => {
            matchCount++;
            if (matchCount === index) {
                return p1 + (isChecked ? 'x' : ' ') + p3;
            }
            return match;
        });

        // We use execCommand to preserve undo stack, replacing everything
        el.textarea.focus();
        el.textarea.setSelectionRange(0, text.length);
        document.execCommand('insertText', false, newText);

        if (window.MarkdownEditor) window.MarkdownEditor.markDirty();
        // The textarea input event will re-render, so the DOM gets replaced,
        // but checkbox is instantly clicked by browser first anyway.
    }

    /* ------------------------------------------------------------------
     * Image Handling
     * ------------------------------------------------------------------ */
    async function insertImageFiles(files) {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return;

        let insertedMarkdown = '';

        for (const file of files) {
            if (workspace) {
                // Workspace mode: write to /Assets/
                try {
                    const sep = workspace.path.includes('\\') ? '\\' : '/';
                    const assetsDir = `${workspace.path}${sep}Assets`;
                    await window.TauriBridge.fs.mkdir(assetsDir, { recursive: true });
                    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const finalPath = `${assetsDir}${sep}${safeName}`;
                    
                    const buffer = await file.arrayBuffer();
                    await window.TauriBridge.fs.writeBinaryFile(finalPath, new Uint8Array(buffer));
                    
                    insertedMarkdown += `![${safeName}](../Assets/${safeName})\n`;
                } catch (e) {
                    console.error("Workspace image save failed", e);
                }
            }
        }

        if (insertedMarkdown) {
            insertAtCursor(insertedMarkdown);
        }
    }

    async function openImageModal() {
        el.imgModal.classList.remove('hidden');
        el.imgGallery.innerHTML = '';
        const workspace = window.WorkspaceManager?.current;

        if (!workspace) {
            el.imgEmpty.classList.remove('hidden');
            el.imgEmpty.textContent = "Quick Mode has no /Assets/ folder. Upload locally instead.";
            return;
        }

        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const assetsDir = `${workspace.path}${sep}Assets`;
            const exists = await window.TauriBridge.fs.exists(assetsDir);
            
            let files = [];
            if (exists) {
                const entries = await window.TauriBridge.fs.readDir(assetsDir);
                files = entries.filter(e => {
                    if (!e || !e.name || e.isDirectory) return false;
                    const n = e.name.toLowerCase();
                    return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.gif') || n.endsWith('.webp') || n.endsWith('.svg');
                });
            }

            if (files.length === 0) {
                el.imgEmpty.classList.remove('hidden');
                el.imgEmpty.textContent = "No images in Workspace /Assets/";
                return;
            }

            el.imgEmpty.classList.add('hidden');
            files.forEach(f => {
                const srcPath = `${assetsDir}${sep}${f.name}`;
                // Convert absolute path to a safe browser asset path using Tauri core
                const safeUrl = window.TauriBridge.core.convertFileSrc(srcPath);

                const item = document.createElement('div');
                item.className = "bg-zinc-950 border border-zinc-700 rounded overflow-hidden cursor-pointer hover:border-amber-500 transition-colors group aspect-square flex items-center justify-center relative";
                item.innerHTML = `
                    <img src="${safeUrl}" class="max-w-full max-h-full object-contain">
                    <div class="absolute bottom-0 inset-x-0 bg-black/80 px-2 py-1 text-[0.65rem] text-zinc-300 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                        ${f.name}
                    </div>
                `;
                item.addEventListener('click', () => {
                    el.imgModal.classList.add('hidden');
                    // Always try to insert relative link for portability in workspace
                    insertAtCursor(`![${f.name}](../Assets/${f.name})`);
                });
                el.imgGallery.appendChild(item);
            });

        } catch (e) {
            console.error("Failed to load assets", e);
        }
    }

    /* ------------------------------------------------------------------
     * Editor Logic
     * ------------------------------------------------------------------ */
    function updatePreview() {
        const text = el.textarea.value;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        el.wordCount.textContent = words;

        // Render markdown. We can add a custom renderer to modify local asset links to Absolute Tauri Links
        if (window.marked && window.DOMPurify) {
            
            // Custom Renderer to fix ../Assets/ local image links into Tauri asset:// links!
            const renderer = new marked.Renderer();
            
            renderer.checkbox = function (token) {
                return '<input type="checkbox" ' + (token.checked ? 'checked ' : '') + '/> ';
            };

            renderer.image = function (token) {
                const href = token.href || '';
                const title = token.title || '';
                const text = token.text || '';
                let actualHref = href;
                const workspace = window.WorkspaceManager?.current;
                
                const normalizedHref = href.replace(/\\/g, '/');
                
                if (workspace && normalizedHref.includes('../Assets/')) {
                    const sep = workspace.path.includes('\\') ? '\\' : '/';
                    const filename = normalizedHref.replace(/.*\/Assets\//, '');
                    const absolutePath = `${workspace.path}${sep}Assets${sep}${filename}`;
                    actualHref = window.TauriBridge.core.convertFileSrc(absolutePath);
                } 
                else if (href.includes(':/') || href.includes(':\\')) {
                    actualHref = window.TauriBridge.core.convertFileSrc(href);
                }
                
                const safeSrc = actualHref.replace(/ /g, '%20');
                const safeAlt = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                
                return `<img src="${safeSrc}" alt="${safeAlt}" title="${safeTitle}" class="max-w-full rounded-lg shadow-md my-4">`;
            };

            const rawHtml = marked.parse(text, { renderer: renderer });
            
            // Reconfigure DOMPurify to allow Tauri's 'asset:' schema alongside standard http/https
            const safeHtml = DOMPurify.sanitize(rawHtml, {
                ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
            });
            el.preview.innerHTML = safeHtml;
        }
    }

    function syncScroll() {
        if (!el.textarea || !el.preview) return;
        const scrollPct = el.textarea.scrollTop / (el.textarea.scrollHeight - el.textarea.clientHeight);
        const targetScroll = scrollPct * (el.preview.scrollHeight - el.preview.clientHeight);
        if (el.preview.scrollHeight > el.preview.clientHeight) {
            el.preview.scrollTop = targetScroll;
        }
    }

    function insertAtCursor(before, after = '', defaultText = '') {
        const start = el.textarea.selectionStart;
        const end = el.textarea.selectionEnd;
        const text = el.textarea.value;
        const selection = start !== end ? text.substring(start, end) : defaultText;

        const newText = before + selection + after;
        
        el.textarea.focus();
        
        // Ensure browser supports execCommand for undo history
        let success = false;
        try {
            success = document.execCommand('insertText', false, newText);
        } catch(e){}

        if (!success) {
            // fallback if execCommand fails
            el.textarea.value = text.substring(0, start) + newText + text.substring(end);
            el.textarea.dispatchEvent(new Event('input'));
        }

        const newCursor = start + before.length + selection.length;
        el.textarea.setSelectionRange(newCursor, newCursor);
    }

    function insertAtLineStart(prefix) {
        const start = el.textarea.selectionStart;
        const text = el.textarea.value;
        
        let lineStart = start;
        while (lineStart > 0 && text[lineStart - 1] !== '\n') {
            lineStart--;
        }

        // We use setSelectionRange to highlight the line prefix conceptually, 
        // to replace it via insertText
        el.textarea.focus();
        el.textarea.setSelectionRange(lineStart, lineStart);
        document.execCommand('insertText', false, prefix);

        const newStart = start + prefix.length;
        el.textarea.setSelectionRange(newStart, newStart);
    }

    /* ------------------------------------------------------------------
     * View Toggles
     * ------------------------------------------------------------------ */
    function setView(mode) {
        el.viewEditor.classList.toggle('active', mode === 'editor');
        el.viewSplit.classList.toggle('active', mode === 'split');
        el.viewPreview.classList.toggle('active', mode === 'preview');

        if (mode === 'editor') {
            el.paneEditor.style.display = 'flex';
            el.panePreview.style.display = 'none';
        } else if (mode === 'preview') {
            el.paneEditor.style.display = 'none';
            el.panePreview.style.display = 'flex';
        } else {
            el.paneEditor.style.display = 'flex';
            el.panePreview.style.display = 'flex';
        }
    }

    return {
        init,
        getContent: () => el.textarea.value,
        setContent: (str) => {
            if (!el.textarea) return;
            el.textarea.value = str;
            updatePreview();
        }
    };
})();

window.MarkdownUI = MarkdownUI;
