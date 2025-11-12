class LanguageToolEditor {
    constructor() {
        this.debounceTimer = null;
        this.currentMention = null;
        this.highlightOverlay = null;
        this.ignoredSuggestions = new Set(); // Track ignored suggestions
        this.llmInProgress = false; // Track if LLM call is in progress
        this.overlayHidden = false; // Track if overlay should be hidden
        this.awaitingCheck = false; // Track if waiting for check to finish
        this.llmQuestions = [];
        this.llmAnswers = {};
        this.llmLastResult = null;
        this.history = [];
        this.activeField = 'editor'; // 'editor' or 'editor2'
        
        // Load rulesets from backend
        this.rulesets = {};
        this.loadRulesets().then(() => {
            // Update scores after rulesets are loaded
            this.updateEditorLabelsWithScore();
        });
 
        // Debug flag for DB interactions
        if (typeof window.FSR_DEBUG === 'undefined') {
            window.FSR_DEBUG = true; // set to false to silence
        }
 
        // Log user session info early
        this.debugFetchUser('init');
        this.fields = {
            editor: {
                editor: document.getElementById('editor'),
                micBtn: document.getElementById('mic-btn'),
                submitBtn: document.getElementById('llm-submit'),
                copyBtn: document.getElementById('copy-btn'),
                highlightOverlay: null,
                ignoredSuggestions: new Set(),
                currentSuggestions: [],
                awaitingCheck: false,
                overlayHidden: false,
                llmInProgress: false,
                history: [],
                llmQuestions: [],
                llmAnswers: {},
                llmLastResult: null
            },
            editor2: {
                editor: document.getElementById('editor2'),
                micBtn: document.getElementById('mic-btn-2'),
                submitBtn: document.getElementById('llm-submit-2'),
                copyBtn: document.getElementById('copy-btn-2'),
                highlightOverlay: null,
                ignoredSuggestions: new Set(),
                currentSuggestions: [],
                awaitingCheck: false,
                overlayHidden: false,
                llmInProgress: false,
                history: [],
                llmQuestions: [],
                llmAnswers: {},
                llmLastResult: null
            }
        };
        this.historyPanel = document.getElementById('history-panel');
        this.historyList = document.getElementById('history-list');
        this.toggleHistoryBtn = document.getElementById('toggle-history');
        this.openHistoryBtn = document.getElementById('open-history-btn');
        this.historyMenuIcon = document.getElementById('history-menu-icon');
        this.historyCloseIcon = document.getElementById('history-close-icon');
        this.popup = document.getElementById('popup');
 
        // App session id for backend correlation
        // Use sessionStorage for unique session per tab, localStorage for shared session across tabs
        this.appSessionId = (() => {
            try {
                // Check if we want unique sessions per tab (default: true)
                const useUniqueSessions = true; // Set to false to use shared sessions across tabs
                
                if (useUniqueSessions) {
                    // Generate unique session per tab
                    const fresh = this.generateUUIDv4();
                    sessionStorage.setItem('app_session_id', fresh);
                    return fresh;
                } else {
                    // Use shared session across tabs (original behavior)
                    const existing = localStorage.getItem('app_session_id');
                    if (existing) return existing;
                    const fresh = this.generateUUIDv4();
                    localStorage.setItem('app_session_id', fresh);
                    return fresh;
                }
            } catch {
                // Fallback if storage unavailable
                return this.generateUUIDv4();
            }
        })();
 
        // Initialize FSR Daily Notes line item tracking (internal only)
        if (this.fields.editor2 && this.fields.editor2.editor) {
            this.fields.editor2.lineItemId = 1; // starts at 1
            this.fields.editor2.lastHadContent = (this.fields.editor2.editor.innerText || '').trim() !== '';
            this.fields.editor2.suppressClearPrompt = false; // to avoid prompts on programmatic clears
            // Initialize the visible label
            const lbl = document.getElementById('line-item-label');
            if (lbl) lbl.textContent = `Line Item: ${this.fields.editor2.lineItemId}`;
        }
        // Initialize Problem Statement version tracking (internal only, no visible label)
        if (this.fields.editor && this.fields.editor.editor) {
            this.fields.editor.problemVersionId = 1; // starts at 1
            this.fields.editor.lastHadContent = (this.fields.editor.editor.innerText || '').trim() !== '';
        }
 
        if (this.toggleHistoryBtn) {
            this.toggleHistoryBtn.addEventListener('click', () => {
                this.historyPanel.classList.add('closed');
                if (this.openHistoryBtn) this.openHistoryBtn.style.display = 'block';
            });
        }
        if (this.openHistoryBtn) {
            this.openHistoryBtn.addEventListener('click', () => {
                this.historyPanel.classList.remove('closed');
                this.openHistoryBtn.style.display = 'none';
            });
        }
        // Hide open-history button if panel is open on load
        if (this.historyPanel && !this.historyPanel.classList.contains('closed') && this.openHistoryBtn) {
            this.openHistoryBtn.style.display = 'none';
        }
        this.renderHistory();
        
        this.initEventListeners();
        this.updateActiveEditorHeader(); // Initialize the header
        this.createHighlightOverlay('editor');
        this.createHighlightOverlay('editor2');
        
        // Case management - initialize asynchronously
        this.caseManager = new CaseManager();
        window.caseManager = this.caseManager; // Make globally accessible for auto-save
        this.caseManager.init(); // Call init() to start async initialization
        this.currentCase = null;
    }
 
    // Lightweight DB interaction logger
    logDb(eventLabel, details) {
        try {
            if (!window.FSR_DEBUG) return;
            const ts = new Date().toISOString();
            // Shallow copy to avoid DOM objects
            const safe = JSON.parse(JSON.stringify(details || {}));
            // eslint-disable-next-line no-console
            console.log(`[DB-DEBUG ${ts}] ${eventLabel}`, safe);
        } catch (e) {
            // ignore logging errors
        }
    }
 
    async debugFetchUser(contextLabel = 'runtime') {
        try {
            const candidates = ['/user'];
            let last = { status: 0, ok: false };
            for (const path of candidates) {
                try {
                    const resp = await fetch(path, { headers: { 'Accept': 'application/json' } });
                    last = { status: resp.status, ok: resp.ok, path };
                    let info = null;
                    try { info = await resp.json(); } catch {}
                    this.logDb('User session check', {
                        context: contextLabel,
                        status: resp.status,
                        ok: resp.ok,
                        path,
                        user: info,
                        location: window.location.href,
                        same_origin: window.location.origin,
                        cookie_present: typeof document !== 'undefined' ? (document.cookie && document.cookie.length > 0) : false
                    });
                    if (resp.ok && info) return info;
                } catch (e) {
                    this.logDb('User session check error', { context: contextLabel, path, error: String(e) });
                }
            }
            // No endpoint succeeded
            this.logDb('User session check: no endpoint responded with user', last);
            return null;
        } catch (e) {
            this.logDb('User session check error', { context: contextLabel, error: String(e) });
            return null;
        }
    }
 
    // Simple UUID v4 generator for session correlation
    generateUUIDv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
 
    // Simple Yes/No modal that resolves to true for Yes, false for No
    // If anchorEl is provided, the modal overlays only that element; otherwise it overlays the viewport
    showYesNoPrompt(message, anchorEl = null) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            const target = anchorEl || document.body;
            // Ensure anchor is positioned for absolute overlay
            if (anchorEl) {
                const computed = window.getComputedStyle(anchorEl);
                if (computed.position === 'static') {
                    anchorEl.style.position = 'relative';
                }
                overlay.style.position = 'absolute';
                overlay.style.inset = '0';
                overlay.style.zIndex = '5';
                // Match the rounded corners of the active editor outline
                overlay.style.borderRadius = computed.borderRadius || '10px';
            } else {
                overlay.style.position = 'fixed';
                overlay.style.inset = '0';
                overlay.style.zIndex = '9999';
            }
            overlay.style.background = 'rgba(0,0,0,0.20)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.pointerEvents = 'auto';
            const dialog = document.createElement('div');
            dialog.style.background = '#fff';
            dialog.style.borderRadius = '8px';
            dialog.style.padding = '16px 16px 12px 16px';
            dialog.style.minWidth = '280px';
            dialog.style.maxWidth = '90%';
            dialog.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
            const msg = document.createElement('div');
            msg.textContent = message || '';
            msg.style.marginBottom = '12px';
            msg.style.color = '#111';
            msg.style.fontWeight = '600';
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '10px';
            actions.style.justifyContent = 'flex-end';
            const noBtn = document.createElement('button');
            noBtn.textContent = 'No';
            noBtn.style.padding = '6px 12px';
            noBtn.style.border = '1px solid #ccc';
            noBtn.style.background = '#fff';
            noBtn.style.borderRadius = '6px';
            noBtn.style.cursor = 'pointer';
            const yesBtn = document.createElement('button');
            yesBtn.textContent = 'Yes';
            yesBtn.style.padding = '6px 12px';
            yesBtn.style.border = 'none';
            yesBtn.style.background = '#41007F';
            yesBtn.style.color = '#fff';
            yesBtn.style.borderRadius = '6px';
            yesBtn.style.cursor = 'pointer';
            actions.appendChild(noBtn);
            actions.appendChild(yesBtn);
            dialog.appendChild(msg);
            dialog.appendChild(actions);
            overlay.appendChild(dialog);
            target.appendChild(overlay);
 
            const cleanup = () => {
                if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
            };
            // Do NOT close on outside click or Escape; require explicit Yes/No
            noBtn.addEventListener('click', () => { cleanup(); resolve(false); });
            yesBtn.addEventListener('click', () => { cleanup(); resolve(true); });
        });
    }
    
    createHighlightOverlay(field) {
        const fieldObj = this.fields[field];
        // Remove any existing overlay
        if (fieldObj.highlightOverlay && fieldObj.highlightOverlay.parentElement) {
            fieldObj.highlightOverlay.parentElement.removeChild(fieldObj.highlightOverlay);
        }
        // Create overlay container
        fieldObj.highlightOverlay = document.createElement('div');
        fieldObj.highlightOverlay.className = 'highlight-overlay';
        fieldObj.highlightOverlay.style.position = 'absolute';
        fieldObj.highlightOverlay.style.top = '0';
        fieldObj.highlightOverlay.style.left = '0';
        fieldObj.highlightOverlay.style.width = '100%';
        fieldObj.highlightOverlay.style.height = '100%';
        fieldObj.highlightOverlay.style.pointerEvents = 'none';
        fieldObj.highlightOverlay.style.zIndex = '1';
        fieldObj.highlightOverlay.style.fontFamily = fieldObj.editor.style.fontFamily || 'inherit';
        fieldObj.highlightOverlay.style.fontSize = fieldObj.editor.style.fontSize || '16px';
        fieldObj.highlightOverlay.style.lineHeight = fieldObj.editor.style.lineHeight || '1.5';
        fieldObj.highlightOverlay.style.padding = '15px';
        fieldObj.highlightOverlay.style.boxSizing = 'border-box';
        fieldObj.highlightOverlay.style.whiteSpace = 'pre-wrap';
        fieldObj.highlightOverlay.style.wordBreak = 'break-word';
        fieldObj.highlightOverlay.style.background = 'transparent';
        fieldObj.editor.parentElement.appendChild(fieldObj.highlightOverlay);
        fieldObj.editor.parentElement.style.position = 'relative';
        // Always scroll overlay to top when created
        fieldObj.highlightOverlay.scrollTop = 0;
    }
    
    // Utility to update the active editor highlight
    updateActiveEditorHighlight() {
        // Remove active/inactive classes from all editor containers
        document.querySelectorAll('.editor-container').forEach((container, idx) => {
            container.classList.remove('active-editor-container');
            container.classList.remove('inactive-editor-container');
        });
        // Add active class to the current active field's container, inactive to the other
        const activeContainer = this.fields[this.activeField].editor.closest('.editor-container');
        if (activeContainer) {
            activeContainer.classList.add('active-editor-container');
        }
        // Add inactive to the other
        const inactiveField = this.activeField === 'editor' ? 'editor2' : 'editor';
        const inactiveContainer = this.fields[inactiveField].editor.closest('.editor-container');
        if (inactiveContainer) {
            inactiveContainer.classList.add('inactive-editor-container');
        }
        // Update the active editor header
        this.updateActiveEditorHeader();
        // Update the score in the label
        this.updateEditorLabelsWithScore();
    }
 
    updateActiveEditorHeader() {
        const header = document.getElementById('active-editor-header');
        if (header) {
            let headerText = '';
            if (this.activeField === 'editor') {
                headerText = 'Current Problem Statement Feedback';
            } else if (this.activeField === 'editor2') {
                headerText = 'Daily FSR Notes Feedback';
            } else {
                headerText = 'Active Editor Feedback';
            }
            header.textContent = headerText;
        }
    }
 
    initEventListeners() {
        ['editor', 'editor2'].forEach(field => {
            const fieldObj = this.fields[field];
            const container = fieldObj.editor.closest('.editor-container');
            // Allow clicking anywhere in the container to focus the editor and place caret at pointer
            container.addEventListener('mousedown', (e) => {
                // Only focus if not clicking a button or inside the popup
                if (!e.target.closest('button') && !e.target.closest('.popup')) {
                    // If click is inside the editor, let browser handle caret
                    if (!fieldObj.editor.contains(e.target)) {
                        fieldObj.editor.focus();
                        // Place caret at end if not clicking inside editor
                        this.setCursorPosition(fieldObj.editor.innerText.length, field);
                        e.preventDefault();
                    } else {
                        // Click inside editor: let browser handle caret
                        // But ensure highlight is applied immediately
                        setTimeout(() => this.updateActiveEditorHighlight(), 0);
                    }
                }
            });
            fieldObj.editor.addEventListener('focus', () => {
                this.activeField = field;
                this.renderHistory();
                this.renderEvaluationAndRewrite(field);
                // Don't call updateHighlights here to preserve scroll position
                this.updateActiveEditorHighlight();
            });
            fieldObj.editor.addEventListener('input', () => {
                // Detect transition from non-empty to empty ONLY for FSR Daily Notes (editor2)
                if (field === 'editor2') {
                    const isNowEmpty = fieldObj.editor.innerText.trim() === '';
                    const wasNonEmpty = !!fieldObj.lastHadContent;
                    if (wasNonEmpty && isNowEmpty && !fieldObj.suppressClearPrompt) {
                        // Anchor the prompt to the editor container so only it is greyed out
                        const anchor = fieldObj.editor.closest('.editor-container') || fieldObj.editor.parentElement;
                        this.showYesNoPrompt('Are you starting a new FSR line item?', anchor).then((confirmNew) => {
                            if (confirmNew) {
                                const current = typeof fieldObj.lineItemId === 'number' ? fieldObj.lineItemId : 1;
                                fieldObj.lineItemId = current + 1;
                                const lbl = document.getElementById('line-item-label');
                                if (lbl) lbl.textContent = `Line Item: ${fieldObj.lineItemId}`;
                            }
                        });
                    }
                    fieldObj.lastHadContent = !isNowEmpty;
                }
                if (!fieldObj.overlayHidden) {
                    this.updateHighlights(field); // Only update overlay if not hidden
                }
                this.debounceCheck(field);
                // No rewrite-eval button anymore
                // Hide rewrite-feedback pill if content changed from last rewrite
                const pillId = field === 'editor' ? 'rewrite-feedback-pill' : 'rewrite-feedback-pill-2';
                const pill = document.getElementById(pillId);
                if (pill && fieldObj.rewrittenSnapshot && fieldObj.editor.innerText !== fieldObj.rewrittenSnapshot) {
                    pill.style.display = 'none';
                }
            });
            fieldObj.editor.addEventListener('paste', (e) => {
                e.preventDefault();
                const text = (e.clipboardData || window.clipboardData).getData('text');
                document.execCommand('insertText', false, text);
            });
            fieldObj.editor.addEventListener('blur', () => {
                if (fieldObj.editor.innerText.trim() === '') {
                    fieldObj.editor.classList.add('empty');
                }
            });
            fieldObj.editor.addEventListener('scroll', () => {
                requestAnimationFrame(() => {
                    this.syncOverlayScroll();
                });
            });
            // Initial check if there's existing text
            if (fieldObj.editor.innerText.trim()) {
                this.checkText(field);
            }
            // LLM submit button event
            const llmButton = fieldObj.submitBtn;
            if (llmButton) {
                llmButton.addEventListener('click', () => {
                    this.activeField = field;
                    this.updateActiveEditorHighlight();
                    this.renderHistory();
                    this.renderEvaluationAndRewrite(field);
                    const text = fieldObj.editor.innerText;
                    // Character limit logic
                    const charLimit = field === 'editor' ? 1000 : 10000;
                    if (text.length > charLimit) {
                        alert(`Over the character limit. The limit is ${charLimit} characters.`);
                        return;
                    }
                    if (text.replace(/\s/g, '').length < 20) {
                        alert('Please make sure your current problem statement is meaningful and comprehensive (at least 20 characters)');
                        return;
                    }
                    this.submitToLLM(text, null, field); // Only text on first submit, pass field
                });
            }
            // Removed rewrite-eval button logic
            // Microphone button logic
            const micBtn = fieldObj.micBtn;
            let isRecording = false;
            let mediaRecorder = null;
            let audioChunks = [];
            if (micBtn) {
                micBtn.addEventListener('click', async () => {
                    this.activeField = field;
                    this.updateActiveEditorHighlight();
                    this.renderHistory();
                    this.renderEvaluationAndRewrite(field);
                    if (!isRecording) {
                        // Clear first
                        const hadContent = fieldObj.editor.innerText.trim() !== '';
                        fieldObj.editor.innerText = '';
                        fieldObj.highlightOverlay.innerHTML = '';
                        fieldObj.editor.setAttribute('data-placeholder', 'Listening...');
                        fieldObj.editor.classList.add('empty');
                        // For FSR Daily Notes, prompt before starting recording (after clear)
                        if (field === 'editor2' && hadContent) {
                            const anchor = fieldObj.editor.closest('.editor-container') || fieldObj.editor.parentElement;
                            const confirmNew = await this.showYesNoPrompt('Are you starting a new FSR line item?', anchor);
                            if (confirmNew) {
                                const current = typeof fieldObj.lineItemId === 'number' ? fieldObj.lineItemId : 1;
                                fieldObj.lineItemId = current + 1;
                                const lbl = document.getElementById('line-item-label');
                                if (lbl) lbl.textContent = `Line Item: ${fieldObj.lineItemId}`;
                            }
                            fieldObj.lastHadContent = false;
                        }
                        fieldObj.editor.setAttribute('contenteditable', 'false');
                        try {
                            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            let mimeType = '';
                            if (MediaRecorder.isTypeSupported('audio/wav')) {
                                mimeType = 'audio/wav';
                            } else if (MediaRecorder.isTypeSupported('audio/webm')) {
                                mimeType = 'audio/webm';
                            } else {
                                mimeType = '';
                            }
                            mediaRecorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
                            audioChunks = [];
                            mediaRecorder.ondataavailable = (e) => {
                                if (e.data.size > 0) audioChunks.push(e.data);
                            };
                            mediaRecorder.onstop = async () => {
                                micBtn.classList.remove('recording-pulse');
                                micBtn.style.background = '';
                                micBtn.style.color = '';
                                micBtn.disabled = true;
                                micBtn.title = 'Record speech';
                                
                                // Restore original microphone icon
                                const micIcon = micBtn.querySelector('svg');
                                if (micIcon) {
                                    micIcon.innerHTML = '<rect x="9" y="2" width="6" height="12" rx="3" fill="#bbb"/><line x1="12" y1="16" x2="12" y2="22" /><path d="M5 11v1a7 7 0 0 0 14 0v-1" />';
                                    micIcon.setAttribute('stroke', '#bbb');
                                    micIcon.setAttribute('stroke-width', '2');
                                    micIcon.setAttribute('stroke-linecap', 'round');
                                    micIcon.setAttribute('stroke-linejoin', 'round');
                                }
 
                                
                                // Update editor placeholder to show transcription in progress
                                fieldObj.editor.setAttribute('data-placeholder', 'Transcribing audio...');
                                fieldObj.editor.innerText = '';
                                fieldObj.editor.classList.add('empty');
                                
                                let audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                                const formData = new FormData();
                                formData.append('audio', audioBlob, 'recording.wav');
                                setTimeout(async () => {
                                    try {
                                        const response = await fetch('/speech-to-text', {
                                            method: 'POST',
                                            body: formData
                                        });
                                        const data = await response.json();
                                        const transcription = data.transcription || '';
                                        
                                        // Check if the transcription indicates insufficient audio content
                                        if (transcription.startsWith("I'm sorry")) {
                                            // Show alert for insufficient audio content
                                            alert('The recorded audio does not contain enough content for transcription. Please try recording again with a longer message.');
                                            fieldObj.editor.innerText = '';
                                            fieldObj.editor.classList.add('empty');
                                        } else {
                                            // Normal transcription - put text in editor
                                            fieldObj.editor.innerText = transcription;
                                            if (fieldObj.editor.innerText.trim() === '') {
                                                fieldObj.editor.classList.add('empty');
                                            } else {
                                                fieldObj.editor.classList.remove('empty');
                                            }
                                            this.checkText(field);
                                            this.llmPlaceholderCall(transcription);
                                        }
                                        
                                        fieldObj.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                    } catch (e) {
                                        fieldObj.editor.innerText = 'Error: Could not transcribe.';
                                        // Status removed - status box no longer used
                                        fieldObj.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                        fieldObj.editor.classList.remove('empty');
                                    }
                                    micBtn.disabled = false;
                                    fieldObj.editor.setAttribute('contenteditable', 'true');
                                }, 1000);
                            };
                            mediaRecorder.start();
                            isRecording = true;
                            micBtn.classList.add('recording-pulse');
                            micBtn.title = 'Recording... Click to stop';
                            
                            // Change icon to white square when recording (reverted)
                            const micIcon = micBtn.querySelector('svg');
                            if (micIcon) {
                                micIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" fill="white"/>';
                                micIcon.removeAttribute('stroke');
                            }
                        } catch (err) {
                            fieldObj.editor.innerText = '';
                            fieldObj.editor.setAttribute('contenteditable', 'true');
                            micBtn.classList.remove('recording-pulse');
                            micBtn.title = 'Record speech';
                            // Reverted: no custom animation styles to reset
                            
                            // Restore original microphone icon in case of error
                            const micIcon = micBtn.querySelector('svg');
                            if (micIcon) {
                                micIcon.innerHTML = '<rect x="9" y="2" width="6" height="12" rx="3" fill="#bbb"/><line x1="12" y1="16" x2="12" y2="22" /><path d="M5 11v1a7 7 0 0 0 14 0v-1" />';
                                micIcon.setAttribute('stroke', '#bbb');
                                micIcon.setAttribute('stroke-width', '2');
                                micIcon.setAttribute('stroke-linecap', 'round');
                                micIcon.setAttribute('stroke-linejoin', 'round');
                            }
                            
                            // Status removed - status box no longer used
                            alert('Could not access microphone.');
                            fieldObj.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                            fieldObj.editor.classList.add('empty');
                        }
                    } else {
                        if (mediaRecorder && mediaRecorder.state === 'recording') {
                            mediaRecorder.stop();
                            isRecording = false;
                        }
                    }
                });
            }
            
            // Copy to clipboard button logic
            const copyBtn = fieldObj.copyBtn;
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    if (copyBtn.disabled) return;
                    const text = fieldObj.editor.innerText;
                    if (text.trim() === '') {
                        // Subtle, no-text feedback on empty content
                        copyBtn.classList.add('copy-error');
                        setTimeout(() => copyBtn.classList.remove('copy-error'), 600);
                        return;
                    }
                    try {
                        await navigator.clipboard.writeText(text);
                        const originalHTML = copyBtn.innerHTML;
                        copyBtn.disabled = true;
                        copyBtn.style.pointerEvents = 'none';
                        copyBtn.innerHTML = `<span style="color:#4CAF50; font-size:1.0em;">✓</span>`;
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHTML;
                            copyBtn.disabled = false;
                            copyBtn.style.pointerEvents = '';
                        }, 1200);
                    } catch (e) {
                        // Subtle, no-text feedback on failure
                        copyBtn.classList.add('copy-error');
                        setTimeout(() => copyBtn.classList.remove('copy-error'), 600);
                    }
                });
            }
 
            // Rewrite feedback pill
            const pillWrapper = document.getElementById(field === 'editor' ? 'rewrite-feedback-pill' : 'rewrite-feedback-pill-2');
            if (pillWrapper) {
                const openPopoverFor = (sentiment) => {
                    this.activeField = field;
                    const pop = document.getElementById('rewrite-feedback-popover');
                    const textarea = document.getElementById('rewrite-feedback-text');
                    const title = document.getElementById('rewrite-feedback-title');
                    const negBtn = pillWrapper.querySelector('.pill-seg.neg');
                    const posBtn = pillWrapper.querySelector('.pill-seg.pos');
                    if (textarea) textarea.value = '';
                    if (title) {
                        if (sentiment === 'positive') {
                            title.textContent = 'Positive feedback on this rewrite';
                            title.style.color = '#2e7d32';
                        } else if (sentiment === 'negative') {
                            title.textContent = 'Negative feedback on this rewrite';
                            title.style.color = '#c62828';
                        } else {
                            title.textContent = 'Feedback on this rewrite';
                            title.style.color = '#41007F';
                        }
                    }
                    // Store pending sentiment for submit
                    this.pendingRewriteSentiment = sentiment;
                    // Color icon only while popover is open
                    if (negBtn) negBtn.classList.toggle('colored', sentiment === 'negative');
                    if (posBtn) posBtn.classList.toggle('colored', sentiment === 'positive');
                    if (pop && pillWrapper) {
                        const rect = pillWrapper.getBoundingClientRect();
                        const top = rect.top + window.scrollY - 10;
                        const left = rect.left + window.scrollX + rect.width + 8;
                        pop.style.top = top + 'px';
                        pop.style.left = left + 'px';
                        pop.style.display = 'block';
                    }
                    // Fire immediate thumbs signal to backend (no text yet) per sentiment
                    try {
                        fetch('/rewrite-feedback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                // Minimal payload for thumbs-only log
                                user_input_id: this.fields[field].userInputId || null,
                                rewrite_uuid: this.fields[field].rewriteUuid || null,
                                feedback_text: '',
                                sentiment
                            })
                        });
                        this.logDb('REWRITE_EVALUATION thumbs event', {
                            user_input_id: this.fields[field].userInputId || null,
                            rewrite_uuid: this.fields[field].rewriteUuid || null,
                            sentiment
                        });
                    } catch {}
                };
                const negBtn = pillWrapper.querySelector('.pill-seg.neg');
                const posBtn = pillWrapper.querySelector('.pill-seg.pos');
                if (negBtn) negBtn.addEventListener('click', () => {
                    negBtn.classList.add('active');
                    if (posBtn) posBtn.classList.remove('active');
                    openPopoverFor('negative');
                });
                if (posBtn) posBtn.addEventListener('click', () => {
                    posBtn.classList.add('active');
                    if (negBtn) negBtn.classList.remove('active');
                    openPopoverFor('positive');
                });
            }
        });
        // Hide popup when clicking outside
        document.addEventListener('mousedown', (e) => {
            const popup = this.popup;
            if (popup && popup.style.display === 'block') {
                if (!popup.contains(e.target)) {
                    this.hidePopup();
                }
            }
        });
        // Attach popup button handlers only once
        const ignoreBtn = this.popup.querySelector('.ignore-button');
        ignoreBtn.onclick = () => {
            this.ignoreCurrentSuggestion(this.popupField);
            this.hidePopup();
        };
 
        // Global handlers for rewrite feedback popover
        const pop = document.getElementById('rewrite-feedback-popover');
        const cancelBtn = document.getElementById('rewrite-feedback-cancel');
        const submitBtn = document.getElementById('rewrite-feedback-submit');
        if (cancelBtn && pop) {
            cancelBtn.onclick = () => {
                pop.style.display = 'none';
                const pill1 = document.getElementById('rewrite-feedback-pill');
                const pill2 = document.getElementById('rewrite-feedback-pill-2');
                [pill1, pill2].forEach(p => {
                    if (!p) return;
                    const neg = p.querySelector('.pill-seg.neg');
                    const pos = p.querySelector('.pill-seg.pos');
                    if (neg) neg.classList.remove('colored');
                    if (pos) pos.classList.remove('colored');
                });
            };
        }
        if (submitBtn && pop) {
            submitBtn.onclick = async () => {
                const field = this.activeField;
                const fieldObj = this.fields[field];
                const textarea = document.getElementById('rewrite-feedback-text');
                const feedbackText = textarea ? textarea.value.trim() : '';
                if (!feedbackText) { pop.style.display = 'none'; return; }
                // Build payload
                let user = {};
                try {
                    const resp = await fetch('/user');
                    user = await resp.json();
                } catch {}
                const payload = {
                    user_input_id: fieldObj.userInputId || null,
                    rewrite_uuid: fieldObj.rewriteUuid || null,
                    feedback_text: feedbackText,
                    sentiment: this.pendingRewriteSentiment || null,
                    timestamp: new Date().toISOString()
                };
                try {
                    const res = await fetch('/rewrite-feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (res.ok) {
                        this.logDb('REWRITE_EVALUATION text submit', payload);
                        pop.style.display = 'none';
                        const pillId = field === 'editor' ? 'rewrite-feedback-pill' : 'rewrite-feedback-pill-2';
                        const pill = document.getElementById(pillId);
                        if (pill) {
                            pill.style.display = 'none';
                            const neg = pill.querySelector('.pill-seg.neg');
                            const pos = pill.querySelector('.pill-seg.pos');
                            if (neg) neg.classList.remove('colored');
                            if (pos) pos.classList.remove('colored');
                        }
                    } else {
                        pop.style.display = 'none';
                        const pill1 = document.getElementById('rewrite-feedback-pill');
                        const pill2 = document.getElementById('rewrite-feedback-pill-2');
                        [pill1, pill2].forEach(p => {
                            if (!p) return;
                            const neg = p.querySelector('.pill-seg.neg');
                            const pos = p.querySelector('.pill-seg.pos');
                            if (neg) neg.classList.remove('colored');
                            if (pos) pos.classList.remove('colored');
                        });
                    }
                } catch (e) {
                    pop.style.display = 'none';
                    const pill1 = document.getElementById('rewrite-feedback-pill');
                    const pill2 = document.getElementById('rewrite-feedback-pill-2');
                    [pill1, pill2].forEach(p => {
                        if (!p) return;
                        const neg = p.querySelector('.pill-seg.neg');
                        const pos = p.querySelector('.pill-seg.pos');
                        if (neg) neg.classList.remove('colored');
                        if (pos) pos.classList.remove('colored');
                    });
                }
            };
        }
 
        // Close rewrite feedback popover when clicking outside
        document.addEventListener('mousedown', (e) => {
            const popover = document.getElementById('rewrite-feedback-popover');
            if (!popover || popover.style.display !== 'block') return;
            const clickedInside = popover.contains(e.target);
            // Close if clicking away; also un-color icons
            const pill1 = document.getElementById('rewrite-feedback-pill');
            const pill2 = document.getElementById('rewrite-feedback-pill-2');
            const clickedPill = (pill1 && pill1.contains(e.target)) || (pill2 && pill2.contains(e.target));
            if (!clickedInside && !clickedPill) {
                popover.style.display = 'none';
                const neg1 = pill1 ? pill1.querySelector('.pill-seg.neg') : null;
                const pos1 = pill1 ? pill1.querySelector('.pill-seg.pos') : null;
                const neg2 = pill2 ? pill2.querySelector('.pill-seg.neg') : null;
                const pos2 = pill2 ? pill2.querySelector('.pill-seg.pos') : null;
                [neg1,pos1,neg2,pos2].forEach(btn => { if (btn) btn.classList.remove('colored'); });
            }
        });
    }
    
    debounceCheck(field) {
        // Status removed - status box no longer used
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.checkText(field);
        }, 1000);
    }
    
    async checkText(field) {
        const text = this.fields[field].editor.innerText;
        const fieldObj = this.fields[field];
        
        if (!text.trim()) {
            this.clearSuggestions(field);
            // Status removed - status box no longer used
            return;
        }
        
        try {
            const response = await fetch('/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: text })
            });
            
            // Filter out ignored suggestions using robust key
            const suggestionsRaw = await response.json();
            const suggestions = suggestionsRaw.filter(
                s => !fieldObj.ignoredSuggestions.has(this.getSuggestionKey(s, text))
            );
            
            fieldObj.currentSuggestions = suggestions;
            fieldObj.awaitingCheck = false;
            fieldObj.overlayHidden = false;
            this.updateHighlights(field);
            
            const count = suggestions.length;
            if (!fieldObj.llmInProgress) {
                if (count === 0) {
                    // Status removed - status box no longer used
                } else {
                    // Status removed - status box no longer used
                }
            }
            
        } catch (error) {
                            // Status removed - status box no longer used
            console.error('Error:', error);
        }
    }
    
    clearSuggestions(field) {
        this.fields[field].currentSuggestions = [];
        this.updateHighlights(field);
    }
    
    updateHighlights(field) {
        const fieldObj = this.fields[field];
        
        // Save current scroll position
        const currentScrollTop = fieldObj.editor.scrollTop;
        const currentScrollLeft = fieldObj.editor.scrollLeft;
        
        if (fieldObj.awaitingCheck || fieldObj.overlayHidden) {
            fieldObj.highlightOverlay.innerHTML = '';
            // Restore scroll position instead of resetting to top
            fieldObj.highlightOverlay.scrollTop = currentScrollTop;
            fieldObj.highlightOverlay.scrollLeft = currentScrollLeft;
            return;
        }
        
        const text = fieldObj.editor.innerText;
        if (fieldObj.currentSuggestions.length === 0) {
            fieldObj.highlightOverlay.innerHTML = '';
            // Restore scroll position instead of resetting to top
            requestAnimationFrame(() => {
                fieldObj.highlightOverlay.scrollTop = currentScrollTop;
                fieldObj.highlightOverlay.scrollLeft = currentScrollLeft;
            });
            return;
        }
        
        // Create highlighted text
        let highlightedText = '';
        let lastIndex = 0;
        fieldObj.currentSuggestions.forEach((suggestion, index) => {
            // Add text before the suggestion
            highlightedText += this.escapeHtml(text.substring(lastIndex, suggestion.offset));
            // Add the highlighted suggestion
            const errorText = text.substring(suggestion.offset, suggestion.offset + suggestion.length);
            let categoryClass = '';
            if (suggestion.errorType === 'spelling') {
                categoryClass = 'highlight-span-spelling';
            } else if (suggestion.errorType === 'grammar') {
                categoryClass = 'highlight-span-grammar';
            } else if (suggestion.errorType) {
                categoryClass = 'highlight-span-other';
            }
            highlightedText += `<span class="highlight-span ${categoryClass}" data-suggestion-index="${index}">${this.escapeHtml(errorText)}</span>`;
            lastIndex = suggestion.offset + suggestion.length;
        });
        // Add any remaining text after the last suggestion
        highlightedText += this.escapeHtml(text.substring(lastIndex));
        fieldObj.highlightOverlay.innerHTML = highlightedText;
        
        // Restore scroll position instead of resetting to top
        requestAnimationFrame(() => {
            fieldObj.highlightOverlay.scrollTop = currentScrollTop;
            fieldObj.highlightOverlay.scrollLeft = currentScrollLeft;
        });
        
        // Attach click handlers to highlights
        const spans = fieldObj.highlightOverlay.querySelectorAll('.highlight-span');
        spans.forEach(span => {
            span.style.borderRadius = '2px';
            span.style.cursor = 'pointer';
            span.style.pointerEvents = 'auto';
            span.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const suggestionIndex = parseInt(span.getAttribute('data-suggestion-index'));
                const suggestion = fieldObj.currentSuggestions[suggestionIndex];
                // Determine the exact character offset within the span where the user clicked
                const localIndex = this.getLocalIndexWithinSpan(span, e);
                const absoluteIndex = suggestion.offset + localIndex;
                this.setCursorPosition(absoluteIndex, field);
                this.showPopup(suggestion, e.clientX, e.clientY, field);
            });
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showPopup(suggestion, x, y, field) {
        const messageDiv = this.popup.querySelector('.popup-message');
        const suggestionsDiv = this.popup.querySelector('.suggestions-list');
        this.popupField = field; // Track which field the popup is for
        
        // Set message
        messageDiv.textContent = suggestion.message;
        
        // Clear and populate suggestions
        suggestionsDiv.innerHTML = '';
        
        if (suggestion.replacements && suggestion.replacements.length > 0) {
            // Only show the top 3 suggestions
            suggestion.replacements.slice(0, 3).forEach((replacement, index) => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = replacement;
                item.onclick = () => this.applySuggestion(suggestion, replacement, field);
                suggestionsDiv.appendChild(item);
            });
        } else {
            const noSuggestions = document.createElement('div');
            noSuggestions.className = 'suggestion-item';
            noSuggestions.textContent = 'No suggestions available';
            noSuggestions.style.fontStyle = 'italic';
            noSuggestions.onclick = null;
            suggestionsDiv.appendChild(noSuggestions);
        }
        
        // Position and show popup
        this.popup.style.display = 'block';
        
        // Adjust position to stay within viewport
        const rect = this.popup.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let adjustedX = x;
        let adjustedY = y;
        
        if (x + rect.width > viewportWidth) {
            adjustedX = viewportWidth - rect.width - 10;
        }
        
        if (y + rect.height > viewportHeight) {
            adjustedY = y - rect.height - 10;
        }
        
        this.popup.style.left = adjustedX + 'px';
        this.popup.style.top = adjustedY + 'px';
        
        // Keep reference to current suggestion
        this.currentMention = suggestion;
        // Add extra blue button for spelling errors
        const ignoreBtn = this.popup.querySelector('.ignore-button');
        ignoreBtn.classList.add('popup-action-button');
        let blueBtn = this.popup.querySelector('.add-term-button');
        if (!blueBtn) {
            blueBtn = document.createElement('button');
            blueBtn.className = 'add-term-button popup-action-button';
            blueBtn.textContent = 'KLA Term';
        }
        // Only show the blue button for spelling errors (red highlight logic)
        if (suggestion.errorType === 'spelling') {
            ignoreBtn.insertAdjacentElement('afterend', blueBtn);
            blueBtn.onclick = () => {
                const text = this.fields[this.popupField].editor.innerText.substring(suggestion.offset, suggestion.offset + suggestion.length);
                // Save the current mention before hiding popup
                const currentMention = this.currentMention;
                this.saveTerm(text, this.popupField, currentMention);
                this.hidePopup();
                // Don't call ignoreCurrentSuggestion here - let saveTerm handle the timing
                // Status removed - status box no longer used
            };
        } else if (blueBtn.parentElement) {
            blueBtn.parentElement.removeChild(blueBtn);
        }
        // Style the ignore button to match the blue button's height and style
        ignoreBtn.style.height = '40px';
        ignoreBtn.style.padding = '8px';
        ignoreBtn.style.fontSize = '14px';
        ignoreBtn.style.borderRadius = '4px';
        ignoreBtn.style.marginTop = '8px';
        ignoreBtn.onclick = () => {
            this.ignoreCurrentSuggestion(this.popupField);
            this.hidePopup();
        };
    }
    
    hidePopup() {
        this.popup.style.display = 'none';
        this.currentMention = null;
    }
    
    applySuggestion(suggestion, replacement, field) {
        // Save selection position and scroll position
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const scrollTop = this.fields[field].editor.scrollTop;
        const scrollLeft = this.fields[field].editor.scrollLeft;
        const text = this.fields[field].editor.innerText;
        const before = text.substring(0, suggestion.offset);
        const after = text.substring(suggestion.offset + suggestion.length);
        this.fields[field].editor.innerText = before + replacement + after;
        // Restore cursor position after replacement
        const newPosition = suggestion.offset + replacement.length;
        this.setCursorPosition(newPosition, field);
        // Restore scroll position
        this.fields[field].editor.scrollTop = scrollTop;
        this.fields[field].editor.scrollLeft = scrollLeft;
        // Remove the suggestion from currentSuggestions so highlight disappears immediately
        const newText = this.fields[field].editor.innerText;
        const key = this.getSuggestionKey(suggestion, newText);
        this.fields[field].currentSuggestions = this.fields[field].currentSuggestions.filter(
            s => this.getSuggestionKey(s, newText) !== key
        );
        this.fields[field].overlayHidden = true;
        this.fields[field].awaitingCheck = true;
        this.updateHighlights(field);
        this.hidePopup();
        requestAnimationFrame(() => this.syncOverlayScroll()); // Ensure overlay is synced after browser updates scroll
        // Status removed - status box no longer used
        this.fields[field].editor.focus();
        this.debounceCheck(field);
    }
    
 
 
    setCursorPosition(pos, field) {
        // Set cursor at character offset 'pos' in the contenteditable div
        this.fields[field].editor.focus();
        const editor = this.fields[field].editor;
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        let remaining = pos;
        while (node) {
            const length = node.textContent.length;
            if (remaining <= length) {
            const range = document.createRange();
                range.setStart(node, Math.max(0, remaining));
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
                return;
            } else {
                remaining -= length;
            }
            node = walker.nextNode();
        }
        // If we get here, place at end
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
 
    // Compute the character index within a highlight span based on click position
    getLocalIndexWithinSpan(span, mouseEvent) {
        const doc = span.ownerDocument || document;
        let range = null;
        if (typeof doc.caretRangeFromPoint === 'function') {
            range = doc.caretRangeFromPoint(mouseEvent.clientX, mouseEvent.clientY);
        } else if (typeof doc.caretPositionFromPoint === 'function') {
            const pos = doc.caretPositionFromPoint(mouseEvent.clientX, mouseEvent.clientY);
            if (pos) {
                range = doc.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            }
        }
        try {
            if (range && span.contains(range.startContainer)) {
                const preRange = doc.createRange();
                preRange.selectNodeContents(span);
                preRange.setEnd(range.startContainer, range.startOffset);
                return preRange.toString().length;
            }
        } catch (_) {
            // fall through to approximation
        }
        // Fallback: approximate based on x position within the span width
        const rect = span.getBoundingClientRect();
        const relX = rect.width > 0 ? (mouseEvent.clientX - rect.left) / rect.width : 0;
        const clamped = Math.max(0, Math.min(1, relX));
        const len = span.textContent ? span.textContent.length : 0;
        return Math.round(clamped * len);
    }
 
    getSuggestionKey(suggestion, text) {
        // Use the error text, ruleId, and message for uniqueness
        const errorText = text.substring(suggestion.offset, suggestion.offset + suggestion.length);
        return `${errorText}:${suggestion.ruleId}:${suggestion.message}`;
    }
 
    ignoreCurrentSuggestion(field) {
        if (this.currentMention) {
            const text = this.fields[field].editor.innerText;
            const key = this.getSuggestionKey(this.currentMention, text);
            this.fields[field].ignoredSuggestions.add(key);
            // Remove from currentSuggestions and update highlights
            this.fields[field].currentSuggestions = this.fields[field].currentSuggestions.filter(
                s => this.getSuggestionKey(s, text) !== key
            );
            this.updateHighlights(field);
        }
        this.hidePopup();
    }
 
    // After LLM submit, always re-apply highlight
    async submitToLLM(text, answers = null, field = this.activeField) {
        const fieldObj = this.fields[field];
        // Capture previous version before rewrite, to log later
        if (answers) {
            fieldObj.prevVersionBeforeRewrite = fieldObj.editor.innerText;
        }
        fieldObj.llmInProgress = true;
        fieldObj.isRestoringFromHistory = false; // Reset flag for new submissions
        if (!this.evalCollapsed) this.evalCollapsed = {};
        // this.evalCollapsed[field] = false; // Expand by default after review/rewrite (REMOVE THIS LINE)
        
        // Update button states
        this.updateButtonState(field, answers ? 'rewriting' : 'reviewing');
        
        if (answers) {
            // Status removed - status box no longer used
        } else {
            // Status removed - status box no longer used
        }
        try {
            let body = { text };
            // Attach correlation/context fields expected by backend when present
            body.app_session_id = this.appSessionId;
            // Provide field and inferred input_field for backend logging
            body.input_field = (field === 'editor2') ? 'fsr' : 'problem_statement';
            body.ruleset = (field === 'editor2') ? 'fsr' : 'problem_statement';
            // Include line item/version tracking for backend logging
            if (field === 'editor2') {
                body.line_item_id = this.fields.editor2 && typeof this.fields.editor2.lineItemId === 'number' ? this.fields.editor2.lineItemId : 1;
            } else {
                body.line_item_id = this.fields.editor && typeof this.fields.editor.problemVersionId === 'number' ? this.fields.editor.problemVersionId : 1;
            }
            // For step 1, include the actual case number from case manager
            if (answers) {
                body.answers = answers;
                body.step = 2;
                if (fieldObj.reviewId) body.review_id = fieldObj.reviewId;
                if (fieldObj.userInputId) body.user_input_id = fieldObj.userInputId;
                if (fieldObj.rewriteUuid) body.rewrite_uuid = fieldObj.rewriteUuid;
            } else {
                body.step = 1;
                // Use actual case number from case manager if available
                if (this.caseManager && this.caseManager.currentCase) {
                    body.case_id = this.caseManager.currentCase.caseNumber;
                    fieldObj.caseId = this.caseManager.currentCase.caseNumber;
                    console.log(`📝 [LLM] Using case number: ${body.case_id}`);
                } else {
                    // Fallback to UUID if no case is active
                    fieldObj.caseId = this.generateUUIDv4();
                    body.case_id = fieldObj.caseId;
                    console.log(`⚠️ [LLM] No active case, using UUID: ${body.case_id}`);
                }
            }
            
            // Capture the case number that this LLM call is for
            const llmCallCaseNumber = body.case_id;
            console.log(`🔒 [LLM] Locking LLM call to case: ${llmCallCaseNumber}`);
            
            const fetchStart = performance.now();
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const fetchTime = performance.now() - fetchStart;
            const parseStart = performance.now();
            const data = await response.json();
            const parseTime = performance.now() - parseStart;
            const totalTime = performance.now() - fetchStart;
            console.log(`⏱️  [TIMING] Frontend - Fetch: ${fetchTime.toFixed(3)}ms, Parse: ${parseTime.toFixed(3)}ms, Total: ${totalTime.toFixed(3)}ms`);
            if (typeof data.result === 'object') {
                // Preserve original text outside of result to avoid polluting evaluation object
                fieldObj.lastOriginalText = text;
                // Step 1 IDs
                if (!answers) {
                    this.logDb('USER_SESSION_INPUTS insert result', {
                        user_input_id: data.result && data.result.user_input_id,
                        rewrite_uuid: data.result && data.result.rewrite_uuid,
                        field,
                        input_field: body && body.input_field,
                        line_item_id: body && body.line_item_id,
                        app_session_id: body && body.app_session_id,
                        case_id: body && body.case_id
                    });
                }
            }
            // Check if the user is still on the same case
            const currentCaseNumber = this.caseManager && this.caseManager.currentCase 
                ? this.caseManager.currentCase.caseNumber 
                : null;
            const isSameCase = currentCaseNumber === llmCallCaseNumber;
            
            console.log(`🔍 [LLM] Response received - Original case: ${llmCallCaseNumber}, Current case: ${currentCaseNumber}, Same: ${isSameCase}`);
            
            if (!isSameCase) {
                // User switched to a different case - save results to the original case but don't display
                console.log(`⚠️ [LLM] User switched cases during LLM call. Saving results to case ${llmCallCaseNumber} without displaying.`);
                
                // Find the original case in the case manager
                if (window.caseManager) {
                    const originalCase = window.caseManager.cases.find(c => c.caseNumber === llmCallCaseNumber);
                    if (originalCase) {
                        // Save the LLM result to that case's editor state
                        if (!originalCase.editorStates) {
                            originalCase.editorStates = {};
                        }
                        if (!originalCase.editorStates[field]) {
                            originalCase.editorStates[field] = {};
                        }
                        
                        // Store the result in the case's editor state
                        originalCase.editorStates[field].llmLastResult = data.result;
                        originalCase.editorStates[field].llmQuestions = data.result && data.result.questions ? data.result.questions : [];
                        originalCase.editorStates[field].llmAnswers = answers || {};
                        
                        // Store IDs
                        if (data.result && data.result.user_input_id) {
                            originalCase.editorStates[field].userInputId = data.result.user_input_id;
                        }
                        if (data.result && data.result.rewrite_uuid) {
                            originalCase.editorStates[field].rewriteUuid = data.result.rewrite_uuid;
                        }
                        if (data.result && data.result.evaluation_id) {
                            originalCase.editorStates[field].evaluationId = data.result.evaluation_id;
                            originalCase.lastEvaluationId = data.result.evaluation_id;
                        }
                        
                        // Store calculated score
                        if (!answers) {
                            const evaluation = data.result && data.result.evaluation ? data.result.evaluation : {};
                            const calculatedScore = this.calculateWeightedScore(field, evaluation);
                            originalCase.editorStates[field].calculatedScore = calculatedScore;
                        }
                        
                        // Store rewrite state
                        if (answers) {
                            originalCase.editorStates[field].rewrittenSnapshot = text; // Store the rewritten text
                            originalCase.editorStates[field].lastRewriteQA = answers;
                            if (Array.isArray(data.result && data.result.user_inputs)) {
                                originalCase.editorStates[field].lastRewriteUserInputs = data.result.user_inputs;
                            }
                        }
                        
                        // Mark LLM as no longer in progress since it completed
                        originalCase.editorStates[field].llmInProgress = false;
                        
                        // Update the case's text with the new content if it's a rewrite
                        if (answers && data.result && data.result.rewrite) {
                            const fieldName = field === 'editor' ? 'problemStatement' : 'fsrNotes';
                            originalCase[fieldName] = data.result.rewrite;
                        }
                        
                        // Save to localStorage
                        window.caseManager.saveCases();
                        console.log(`✅ [LLM] Results saved to case ${llmCallCaseNumber} for later viewing`);
                    } else {
                        console.warn(`⚠️ [LLM] Could not find case ${llmCallCaseNumber} to save results`);
                    }
                }
                
                // Reset the field's loading state but don't display anything
                fieldObj.llmInProgress = false;
                this.resetButtonState(field);
                return; // Exit early - don't display results
            }
            
            // User is still on the same case - display results normally
            console.log(`✅ [LLM] User still on same case. Displaying results.`);
            
            fieldObj.llmLastResult = data.result;
            // Capture IDs returned from backend for coordination (no DB lookups)
            if (data.result && data.result.user_input_id) {
                fieldObj.userInputId = data.result.user_input_id;
            }
            if (data.result && data.result.rewrite_uuid) {
                fieldObj.rewriteUuid = data.result.rewrite_uuid;
            }
            if (data.result && data.result.evaluation_id) {
                fieldObj.evaluationId = data.result.evaluation_id;
                // Store evaluation ID in current case for input state update
                if (this.currentCase) {
                    this.currentCase.lastEvaluationId = data.result.evaluation_id;
                }
            }
            
            // Add to history when submitting for evaluation (not rewrite)
            if (!answers) {
                this.addToHistory(text, field, data.result);
                
                // Store calculated score for potential future use
                const evaluation = data.result && data.result.evaluation ? data.result.evaluation : {};
                const calculatedScore = this.calculateWeightedScore(field, evaluation);
                this.fields[field].calculatedScore = calculatedScore;
            }
            
            this.displayLLMResult(data.result, answers !== null, field, !answers);
            this.updateActiveEditorHighlight(); // Ensure highlight remains
            // If this was a rewrite, snapshot state and show pill
            if (answers) {
                const pillId = field === 'editor' ? 'rewrite-feedback-pill' : 'rewrite-feedback-pill-2';
                const pill = document.getElementById(pillId);
                if (pill) pill.style.display = 'block';
                fieldObj.rewrittenSnapshot = fieldObj.editor.innerText;
                fieldObj.lastRewriteQA = answers;
                // Log rewrite inputs mapping if backend returns it
                if (Array.isArray(data.result && data.result.user_inputs)) {
                    this.logDb('USER_REWRITE_INPUTS inserted', { user_inputs: data.result.user_inputs });
                }
            }
            
            // Auto-save case state after LLM evaluation or rewrite
            if (window.caseManager) {
                console.log('💾 [Auto-save] Saving case state after LLM call');
                window.caseManager.saveCurrentCaseState();
            }
        } catch (e) {
            alert('LLM call failed: ' + e);
            fieldObj.llmInProgress = false;
            this.resetButtonState(field);
            this.updateActiveEditorHighlight(); // Ensure highlight remains
        }
    }
 
    displayLLMResult(result, showRewrite, field = this.activeField, isNewEvaluation = false) {
        const fieldObj = this.fields[field];
        
        // If no result but field is being reviewed, preserve loading state
        if (!result && fieldObj.llmInProgress) {
            // Keep the loading state when switching between boxes during active review
            return;
        }
        
        fieldObj.llmInProgress = false;
        
        // Reset button states when LLM call completes
        this.resetButtonState(field);
        
        // Only display the result if this field is currently active
        // Exception: Always show rewrite results (follow-up questions) even if in different box
        if (field !== this.activeField && !showRewrite) {
            return;
        }
        
        const evalBox = document.getElementById('llm-eval-box');
        let html = '';
        let valid = result && typeof result === 'object';
        let rulesObj = result && result.evaluation ? result.evaluation : result;
        // Persist review_id and user_input_id from backend (step 1)
        if (result && result.review_id) {
            fieldObj.reviewId = result.review_id;
        }
        if (result && result.user_input_id) {
            fieldObj.userInputId = result.user_input_id;
        }
        // Collapsible state (per field)
        if (!this.evalCollapsed) this.evalCollapsed = {};
        if (typeof this.evalCollapsed[field] === 'undefined') this.evalCollapsed[field] = true; // Collapsed by default
        // After rewrite, always close the feedback dropdown
        if (showRewrite) {
            this.evalCollapsed[field] = true;
        }
        const isCollapsed = this.evalCollapsed[field];
        
        // Check for evaluation error
        if (result && result.error) {
            html += `<div style="background:#fff3cd; border:1px solid #ffeaa7; color:#856404; padding:15px; border-radius:8px; margin:10px 0;">
                <strong>Evaluation Error:</strong> ${this.escapeHtml(result.error)}
                <br><br>
                <button onclick="location.reload()" style="background:#856404; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">Try Again</button>
            </div>`;
        } else if (valid && rulesObj && typeof rulesObj === 'object') {
            // Map criteria -> rewrite_id for later feedback payloads
            try {
                fieldObj.rewriteIdByCriteria = {};
                Object.keys(rulesObj).forEach(k => {
                    const sec = rulesObj[k];
                    if (sec && typeof sec === 'object' && sec.rewrite_id) {
                        fieldObj.rewriteIdByCriteria[k] = sec.rewrite_id;
                    }
                });
            } catch {}
            const keys = Object.keys(rulesObj);
            const total = keys.length;
            const passed = keys.filter(key => rulesObj[key].passed).length;
            let inputType = 'How Your Score Was Calculated';
            // Replace score box with feedback title
            html += `<div class="llm-score" style="font-size:1.35em;font-weight:700;margin-bottom:0;background:#fff;color:#41007F;padding:10px 0 10px 0;border-radius:8px;text-align:center;box-shadow:0 1px 4px rgba(33,0,127,0.07);letter-spacing:0.5px;display:flex;align-items:center;justify-content:center;gap:10px;position:relative;">\n` +
                `<button id="eval-collapse-btn" title="Click to expand for details" style="background:rgba(65,0,127,0.05);border:none;cursor:pointer;padding:0 6px;outline:none;display:inline-flex;align-items:center;justify-content:center;position:absolute;left:8px;top:50%;width:24px;height:24px;z-index:2;border-radius:4px;transition:background 0.2s ease;">\n` +
                `<span id="eval-chevron" style="font-size:1.3em;">▶</span>\n` +
                `</button>\n` +
                `<span style="margin-left:32px;font-size:1.5em;">${inputType}</span>\n` +
                `</div>`;
                        // Always create content div, but set display based on collapsed state
            html += '<div class="llm-eval-content" style="display: ' + (isCollapsed ? 'none' : 'block') + ';">';
                // Sort rules: passed first, then failed
                const sortedKeys = keys.sort((a, b) => {
                    const aPassed = rulesObj[a].passed;
                    const bPassed = rulesObj[b].passed;
                    if (aPassed === bPassed) return 0;
                    return aPassed ? -1 : 1;
                });
                // Separate passed and failed
                const passedKeys = sortedKeys.filter(key => rulesObj[key].passed);
                const failedKeys = sortedKeys.filter(key => !rulesObj[key].passed);
                // Show Needs Improvement first, then Completed
                if (failedKeys.length > 0) {
                    html += `<div style="font-weight:600;font-size:1.08em;color:#f44336;margin:18px 0 8px 0;">Needs Improvement</div>`;
                    for (const key of failedKeys) {
                        const section = rulesObj[key];
                        const displayName = section.display_name || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        html += `
                            <div class="llm-section llm-dropdown open" data-passed="false">
                                <div class="llm-section-header" tabindex="0">
                                <span class="llm-dropdown-arrow open">▶</span>
                                    <span class="llm-section-title" style="color:#111;" data-criteria="${this.escapeHtml(key)}"><strong>${this.escapeHtml(displayName)}</strong></span>
                                    <span class="llm-feedback-btn" title="Give feedback" data-criteria="${this.escapeHtml(key)}">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="thumbs-down-icon" viewBox="0 0 16 16">
                                            <path d="M8.864 15.674c-.956.24-1.843-.484-1.908-1.42-.072-1.05-.23-2.015-.428-2.59-.125-.36-.479-1.012-1.04-1.638-.557-.624-1.282-1.179-2.131-1.41C2.685 8.432 2 7.85 2 7V3c0-.845.682-1.464 1.448-1.546 1.07-.113 1.564-.415 2.068-.723l.048-.029c.272-.166.578-.349.97-.484C6.931.08 7.395 0 8 0h3.5c.937 0 1.599.478 1.934 1.064.164.287.254.607.254.913 0 .152-.023.312-.077.464.201.262.38.577.488.9.11.33.172.762.004 1.15.069.13.12.268.159.403.077.27.113.567.113.856s-.036.586-.113.856c-.035.12-.08.244-.138.363.394.571.418 1.2.234 1.733-.206.592-.682 1.1-1.2 1.272-.847.283-1.803.276-2.516.211a10 10 0 0 1-.443-.05 9.36 9.36 0 0 1-.062 4.51c-.138.508-.55.848-1.012.964zM11.5 1H8c-.51 0-.863.068-1.14.163-.281.097-.506.229-.776.393l-.04.025c-.555.338-1.198.73-2.49.868-.333.035-.554.29-.554.55V7c0 .255.226.543.62.65 1.095.3 1.977.997 2.614 1.709.635.71 1.064 1.475 1.238 1.977.243.7.407 1.768.482 2.85.025.362.36.595.667.518l.262-.065c.16-.04.258-.144.288-.255a8.34 8.34 0 0 0-.145-4.726.5.5 0 0 1 .595-.643h.003l.014.004.058.013a9 9 0 0 0 1.036.157c.663.06 1.457.054 2.11-.163.175-.059.45-.301.57-.651.107-.308.087-.67-.266-1.021L12.793 7l.353-.354c.043-.042.105-.14.154-.315.048-.167.075-.37.075-.581s-.027-.414-.075-.581c-.05-.174-.111-.273-.154-.315l-.353-.354.353-.354c.047-.047.109-.176.005-.488a2.2 2.2 0 0 0-.505-.804l-.353-.354.353-.354c.006-.005.041-.05.041-.17a.9.9 0 0 0-.121-.415C12.4 1.272 12.063 1 11.5 1"/>
                                        </svg>
                                    </span>
                                </div>
                                <div class="llm-section-justification" style="display:block;">${this.escapeHtml(section.justification || '')}</div>
                            </div>
                        `;
                    }
                }
                if (passedKeys.length > 0) {
                    html += `<div style="font-weight:600;font-size:1.08em;color:#4CAF50;margin-bottom:8px;">Completed</div>`;
                    for (const key of passedKeys) {
                        const section = rulesObj[key];
                        const displayName = section.display_name || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        html += `
                            <div class="llm-section llm-dropdown" data-passed="true">
                                <div class="llm-section-header" tabindex="0">
                                <span class="llm-dropdown-arrow">▶</span>
                                    <span class="llm-section-title" style="color:#111;" data-criteria="${this.escapeHtml(key)}"><strong>${this.escapeHtml(displayName)}</strong></span>
                                    <span class="llm-feedback-btn" title="Give feedback" data-criteria="${this.escapeHtml(key)}">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="thumbs-down-icon" viewBox="0 0 16 16">
                                            <path d="M8.864 15.674c-.956.24-1.843-.484-1.908-1.42-.072-1.05-.23-2.015-.428-2.59-.125-.36-.479-1.012-1.04-1.638-.557-.624-1.282-1.179-2.131-1.41C2.685 8.432 2 7.85 2 7V3c0-.845.682-1.464 1.448-1.546 1.07-.113 1.564-.415 2.068-.723l.048-.029c.272-.166.578-.349.97-.484C6.931.08 7.395 0 8 0h3.5c.937 0 1.599.478 1.934 1.064.164.287.254.607.254.913 0 .152-.023.312-.077.464.201.262.38.577.488.9.11.33.172.762.004 1.15.069.13.12.268.159.403.077.27.113.567.113.856s-.036.586-.113.856c-.035.12-.08.244-.138.363.394.571.418 1.2.234 1.733-.206.592-.682 1.1-1.2 1.272-.847.283-1.803.276-2.516.211a10 10 0 0 1-.443-.05 9.36 9.36 0 0 1-.062 4.51c-.138.508-.55.848-1.012.964zM11.5 1H8c-.51 0-.863.068-1.14.163-.281.097-.506.229-.776.393l-.04.025c-.555.338-1.198.73-2.49.868-.333.035-.554.29-.554.55V7c0 .255.226.543.62.65 1.095.3 1.977.997 2.614 1.709.635.71 1.064 1.475 1.238 1.977.243.7.407 1.768.482 2.85.025.362.36.595.667.518l.262-.065c.16-.04.258-.144.288-.255a8.34 8.34 0 0 0-.145-4.726.5.5 0 0 1 .595-.643h.003l.014.004.058.013a9 9 0 0 0 1.036.157c.663.06 1.457.054 2.11-.163.175-.059.45-.301.57-.651.107-.308.087-.67-.266-1.021L12.793 7l.353-.354c.043-.042.105-.14.154-.315.048-.167.075-.37.075-.581s-.027-.414-.075-.581c-.05-.174-.111-.273-.154-.315l-.353-.354.353-.354c.047-.047.109-.176.005-.488a2.2 2.2 0 0 0-.505-.804l-.353-.354.353-.354c.006-.005.041-.05.041-.17a.9.9 0 0 0-.121-.415C12.4 1.272 12.063 1 11.5 1"/>
                                        </svg>
                                    </span>
                                </div>
                                <div class="llm-section-justification" style="display:none;">${this.escapeHtml(section.justification || '')}</div>
                            </div>
                        `;
                    }
                }
            html += '</div>';
        } else {
            evalBox.innerHTML = '';
            evalBox.style.display = 'none';
            return;
        }
        evalBox.innerHTML = html;
        evalBox.style.display = 'flex';
        
        // Check if button exists immediately after setting HTML
        setTimeout(() => {
            const btnCheck = document.getElementById('eval-collapse-btn');
            if (btnCheck) {
                btnCheck.onclick = () => {
                    this.evalCollapsed[field] = !this.evalCollapsed[field];
                    
                    // Instead of regenerating HTML, just toggle the class and show/hide content
                    btnCheck.classList.toggle('collapsed', this.evalCollapsed[field]);
                    
                    const evalBox = document.getElementById('llm-eval-box');
                    if (evalBox) {
                        const content = evalBox.querySelector('.llm-eval-content');
                        if (content) {
                            const newDisplay = this.evalCollapsed[field] ? 'none' : 'block';
                            content.style.display = newDisplay;
                        }
                    }
                };
                // Set initial state
                btnCheck.classList.toggle('collapsed', this.evalCollapsed[field]);
            }
        }, 0);
        
        // Add all event listeners for evaluation elements after HTML is set
        setTimeout(() => {
            this.addEvaluationEventListeners(field);
        }, 0);
 
        // --- Questions and rewrite popup logic ---
        const rewritePopup = document.getElementById('rewrite-popup');
        if (!showRewrite) {
            // Show questions for failed criteria
            const newQuestions = [];
            if (rulesObj) {
                for (const key of Object.keys(rulesObj)) {
                    const section = rulesObj[key];
                    if (!section.passed && section.question) {
                        newQuestions.push({ criteria: key, question: section.question, rewrite_id: section.rewrite_id || '' });
                    }
                }
            }
            
            // Only clear answers when a new evaluation produces a new set of questions.
            // Preserve answers when simply switching active boxes.
            if (isNewEvaluation) {
                fieldObj.llmAnswers = {};
            }
            
            fieldObj.llmQuestions = newQuestions;
            if (fieldObj.llmQuestions.length > 0) {
                // Determine color based on active editor
                const isProblemStatement = field === 'editor';
                const borderColor = isProblemStatement ? '#41007F' : '#00A7E1';
                const backgroundColor = isProblemStatement ? 'rgba(240, 240, 255, 0.3)' : 'rgba(240, 248, 255, 0.3)';
                let qHtml = '<div class="rewrite-title" style="display:flex;align-items:center;font-weight:700;font-size:1.13em;color:#41007F;margin-bottom:8px;">To improve your input, please answer the following questions:</div>';
                qHtml += `<div class="rewrite-title" style="border: 2px solid ${borderColor}; background: ${backgroundColor}; border-radius: 10px; padding: 18px 18px 10px 18px; margin-bottom: 10px; margin-top: 10px;">`;
                fieldObj.llmQuestions.forEach((q, idx) => {
                    const rewriteId = q.rewrite_id || '';
                    qHtml += `<div class="rewrite-question">${this.escapeHtml(q.question)}</div>`;
                    const existingAnswer = fieldObj.llmAnswers && fieldObj.llmAnswers[q.criteria] ? (fieldObj.llmAnswers[q.criteria] || '') : '';
                    qHtml += `<textarea class="rewrite-answer" data-criteria="${this.escapeHtml(q.criteria)}" data-rewrite-id="${this.escapeHtml(rewriteId)}" rows="1" style="width:100%;margin-bottom:12px;resize:none;">${this.escapeHtml(existingAnswer)}</textarea>`;
                });
                qHtml += `<button id="submit-answers-btn" class="llm-submit-button" style="margin-top:10px;">Rewrite</button>`;
                rewritePopup.innerHTML = qHtml;
                rewritePopup.style.display = 'block';
                
                // Auto-scroll to rewrite questions on mobile (stacked layout)
                this.autoScrollToRewriteQuestions();
                
                setTimeout(() => {
                    const btn = document.getElementById('submit-answers-btn');
                    const answerEls = rewritePopup.querySelectorAll('.rewrite-answer');
                    // Save answer on input
                    answerEls.forEach(el => {
                        el.addEventListener('input', () => {
                            const crit = el.getAttribute('data-criteria');
                            fieldObj.llmAnswers[crit] = el.value;
                        });
                        el.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                el.blur();
                            }
                        });
                    });
                    if (btn) {
                        btn.onclick = () => {
                            // Build answers payload preferring rewrite_id
                            const answersPayload = [];
                            answerEls.forEach(el => {
                                const rewriteId = el.getAttribute('data-rewrite-id');
                                const answer = el.value;
                                if (rewriteId) {
                                    answersPayload.push({ rewrite_id: rewriteId, answer });
                                } else {
                                const crit = el.getAttribute('data-criteria');
                                    if (crit) {
                                        fieldObj.llmAnswers[crit] = answer;
                                    }
                                }
                            });
                            const toSend = answersPayload.length > 0 ? answersPayload : fieldObj.llmAnswers;
                            this.submitToLLM(fieldObj.editor.innerText, toSend, field);
                        };
                    }
                }, 100);
            } else {
                rewritePopup.style.display = 'none';
            }
        } else {
            // Show suggested rewrite (after answers submitted)
            let rewrite = '';
            if (result && typeof result === 'object') {
                if (result.rewritten_problem_statement) {
                    rewrite = result.rewritten_problem_statement;
                } else if (result.rewrite) {
                    rewrite = result.rewrite;
                }
            }
            if (rewrite) {
                fieldObj.editor.innerText = rewrite;
                fieldObj.overlayHidden = true;
                this.updateHighlights(field);
                rewritePopup.style.display = 'none';
                evalBox.style.display = 'none';
                this.checkText(field);
                
                // Auto-scroll back to the rewritten box on mobile (stacked layout)
                this.autoScrollToRewrittenBox(field);
                // Persist user_inputs mapping from backend (rewrite_id -> user_input_id)
                if (result && Array.isArray(result.user_inputs)) {
                    fieldObj.lastRewriteUserInputs = result.user_inputs;
                } else {
                    fieldObj.lastRewriteUserInputs = [];
                }
                this.submitToLLM(rewrite, null, field);
            } else {
                rewritePopup.style.display = 'none';
            }
        }
    }
 
    // Synchronize scrolling between overlay and editor
    syncOverlayScroll() {
        ['editor', 'editor2'].forEach(field => {
            const fieldObj = this.fields[field];
            if (!fieldObj.highlightOverlay || !fieldObj.editor) return;
            
            let isScrolling = false;
            
            // Sync overlay scroll to editor
            fieldObj.editor.onscroll = () => {
                if (!isScrolling) {
                    isScrolling = true;
                    fieldObj.highlightOverlay.scrollTop = fieldObj.editor.scrollTop;
                    fieldObj.highlightOverlay.scrollLeft = fieldObj.editor.scrollLeft;
                    setTimeout(() => { isScrolling = false; }, 10);
                }
            };
            
            // Sync editor scroll to overlay
            fieldObj.highlightOverlay.onscroll = () => {
                if (!isScrolling) {
                    isScrolling = true;
                    fieldObj.editor.scrollTop = fieldObj.highlightOverlay.scrollTop;
                    fieldObj.editor.scrollLeft = fieldObj.highlightOverlay.scrollLeft;
                    setTimeout(() => { isScrolling = false; }, 10);
                }
            };
        });
    }
 
    // Update the label/title of each text box to include the temperature bar
    updateEditorLabelsWithScore() {
        const score1 = document.getElementById('score-editor');
        const score2 = document.getElementById('score-editor2');
        const r1 = this.fields['editor'].llmLastResult;
        const r2 = this.fields['editor2'].llmLastResult;
        
        // Update Current Problem Statement temperature bar
        if (r1 && r1.evaluation) {
            const weightedScore = this.calculateWeightedScore('editor', r1.evaluation);
            const percentage = Math.round(weightedScore);
            this.fields['editor'].calculatedScore = percentage; // expose for backend if needed
            
            score1.innerHTML = this.createTemperatureBar(percentage);
            score1.className = 'editor-score';
            } else {
            score1.innerHTML = '';
            score1.className = 'editor-score';
        }
        
        // Update Daily FSR Notes temperature bar
        if (r2 && r2.evaluation) {
            const weightedScore = this.calculateWeightedScore('editor2', r2.evaluation);
            const percentage = Math.round(weightedScore);
            this.fields['editor2'].calculatedScore = percentage;
            
            score2.innerHTML = this.createTemperatureBar(percentage);
            score2.className = 'editor-score';
            } else {
            score2.innerHTML = '';
            score2.className = 'editor-score';
        }
    }
 
    // Auto-scroll to rewrite questions when they are generated (mobile stacked layout)
    autoScrollToRewriteQuestions() {
        // Only auto-scroll on mobile (stacked layout) - when content-flex is column
        const contentFlex = document.querySelector('.content-flex');
        if (contentFlex && window.getComputedStyle(contentFlex).flexDirection === 'column') {
            const rewritePopup = document.getElementById('rewrite-popup');
            if (rewritePopup) {
                // Smooth scroll to the rewrite popup
                rewritePopup.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start',
                    inline: 'nearest'
                });
            }
        }
    }
    
    // Auto-scroll back to the rewritten editor box when rewrite is completed
    autoScrollToRewrittenBox(field) {
        // Only auto-scroll on mobile (stacked layout) - when content-flex is column
        const contentFlex = document.querySelector('.content-flex');
        if (contentFlex && window.getComputedStyle(contentFlex).flexDirection === 'column') {
            const editorContainer = document.querySelector(`#${field}`).closest('.editor-container');
            if (editorContainer) {
                // Smooth scroll to the editor container
                editorContainer.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start',
                    inline: 'nearest'
                });
            }
        }
    }

    // Create temperature bar with gradient from red to yellow to green
    createTemperatureBar(percentage) {
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        const position = clampedPercentage; // 0-100
        
        return `
            <div class="score-bar-container">
                <div class="score-bar-wrapper">
                    <div class="score-bar" style="position: relative; width: 120px; height: 18px; background: linear-gradient(to right, #ff6b6b 0%, #ffd93d 50%, #6bcf7f 100%); border-radius: 9px; border: 2px solid #e0e0e0; overflow: visible; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="position: absolute; top: 50%; left: ${position}%; width: 2px; height: 28px; background: linear-gradient(to bottom, #41007F, #5a1a9a); border-radius: 1px; transform: translate(-50%, -50%); border: 1px solid #fff; box-shadow: 0 2px 8px rgba(65,0,127,0.4), 0 0 0 1px rgba(255,255,255,0.8);"></div>
                    </div>
                </div>
                <div class="score-bar-labels">
                    <span class="score-label-left">Vague</span>
                    <span class="score-label-right">Thorough</span>
                </div>
            </div>
            <style>
                .score-bar-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.85em;
                    font-weight: 600;
                    padding: 4px 0;
                }
                
                .score-bar-labels {
                    display: flex;
                    justify-content: space-between;
                    width: 120px;
                    color: #000;
                    font-size: 0.9em;
                }
                
                @media (max-width: 950px) {
                    .score-bar-labels {
                        width: 100px;
                    }
                }
                
                .score-label-left {
                    color: #000;
                    font-size: 0.9em;
                }
                
                .score-label-right {
                    color: #000;
                    font-size: 0.9em;
                }
                
                .score-bar-wrapper {
                    display: flex;
                    justify-content: center;
                }
                
                @media (max-width: 450px) {
                    .score-bar-container {
                        gap: 4px;
                    }
                    
                    .score-bar-labels {
                        width: 80px;
                        font-size: 0.8em;
                    }
                    
                    .score-bar {
                        width: 80px !important;
                        height: 16px !important;
                    }
                    
                    .score-bar > div {
                        height: 24px !important;
                    }
                }
                
                @media (max-width: 950px) {
                    .editor-score {
                        font-size: 0.9em !important;
                    }
                    .score-bar-container {
                        gap: 6px !important;
                    }
                    .score-bar {
                        width: 100px !important;
                        height: 16px !important;
                    }
                    .score-bar > div {
                        height: 24px !important;
                        top: 50% !important;
                        transform: translate(-50%, -50%) !important;
                    }
                    .score-bar-labels {
                        width: 100px !important;
                        font-size: 0.85em !important;
                    }
                }
            </style>
        `;
    }
 
    // Load rulesets from backend
    async loadRulesets() {
        try {
            const [ps, fsr] = await Promise.all([
                fetch('/ruleset/problem_statement').then(res => res.json()),
                fetch('/ruleset/fsr').then(res => res.json())
            ]);
 
            this.rulesets = { editor: ps, editor2: fsr };
            this.logDb('Loaded criteria from CRITERIA_GROUPS (DEFAULT)', {
                problem_statement: ps,
                fsr
            });
        } catch (error) {
            console.error('Error loading rulesets:', error);
        }
    }
 
    // Calculate weighted score based on criteria weights from backend
    calculateWeightedScore(field, evaluation) {
        const ruleset = this.rulesets[field];
        if (!ruleset || !ruleset.rules) {
            return 0;
        }
        
        let totalScore = 0;
        let totalWeight = 0;
        
        for (const rule of ruleset.rules) {
            const criteriaName = rule.name;
            const weight = rule.weight;
            
            if (evaluation[criteriaName]) {
                totalScore += evaluation[criteriaName].passed ? weight : 0;
                totalWeight += weight;
            }
        }
        
        // Automatically normalize to 100 regardless of actual weight sum
        // This ensures the score is always 0-100 even if weights don't sum to 100
        return totalWeight > 0 ? (totalScore / totalWeight) * 100 : 0;
    }
 
    // --- Placeholder for LLM call after transcription ---
    llmPlaceholderCall(transcription) {
        if (!transcription || transcription.trim() === '') return;
        // TODO: Replace this with your actual LLM call logic
        // Example: this.submitToLLM(transcription);
    }
 
    saveTerm(term, field, savedMention = null) {
        // Apply blue highlight IMMEDIATELY for instant feedback
        this.flashTerm(term, field, savedMention);
        
        fetch('/terms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term })
        })
        .then(res => {
            if (!res.ok) throw new Error('Failed to add term');
            
            setTimeout(() => {
                if (savedMention) {
                    const text = this.fields[field].editor.innerText;
                    const key = this.getSuggestionKey(savedMention, text);
                    this.fields[field].ignoredSuggestions.add(key);
                    this.fields[field].currentSuggestions = this.fields[field].currentSuggestions.filter(
                        s => this.getSuggestionKey(s, text) !== key
                    );
                    this.updateHighlights(field);
                    
                    // Show the overlay again after highlights are updated
                    const overlay = this.fields[field].highlightOverlay;
                    if (overlay) {
                        overlay.style.display = 'block';
                    }
                }
                
                this.checkText('editor');
                this.checkText('editor2');
            }, 1600); // Wait 1.6 seconds (slightly longer than the 1.5-second blue highlight)
        })
        .catch((error) => {
            // Error handling removed - status box no longer used
        });
    }
    
    // Flash a term with blue color to indicate it was added to dictionary
    flashTerm(term, field, savedMention = null) {
        const mentionToUse = savedMention || this.currentMention;
        
        if (mentionToUse) {
            const overlay = this.fields[field].highlightOverlay;
            
            if (overlay) {
                const suggestionIndex = this.fields[field].currentSuggestions.findIndex(s => 
                    s.offset === mentionToUse.offset && s.length === mentionToUse.length
                );
                
                if (suggestionIndex !== -1) {
                    const spanSelector = `[data-suggestion-index="${suggestionIndex}"]`;
                    const span = overlay.querySelector(spanSelector);
                    
                    if (span) {
                        // Use the same blue as the submit button (#00A7E1)
                        span.style.backgroundColor = 'rgba(0, 167, 225, 0.3)';
                        span.style.borderBottom = '2px solid #00A7E1';
                        span.style.color = 'black';
                        
                        setTimeout(() => {
                            span.remove();
                            
                            // Hide the overlay AFTER blue is removed, during recalculation
                            const overlay = this.fields[field].highlightOverlay;
                            if (overlay) {
                                overlay.style.display = 'none';
                            }
                        }, 1500);
                    }
                }
            }
        }
    }
 
    addToHistory(text, field = this.activeField, evaluationResult = null) {
        if (!text || !text.trim()) return;
        const fieldObj = this.fields[field];
        
        // Trim newlines from the ends before adding to history
        const trimmedText = text.trim();
        
        // Use provided evaluation result or current one
        const resultToStore = evaluationResult || fieldObj.llmLastResult;
        
        // Create history entry with complete state
        const historyEntry = {
            text: trimmedText,
            llmLastResult: resultToStore ? JSON.parse(JSON.stringify(resultToStore)) : null,
            userInputId: fieldObj.userInputId || null,
            rewriteUuid: fieldObj.rewriteUuid || null,
            reviewId: fieldObj.reviewId || null,
            timestamp: new Date().toISOString()
        };
        
        fieldObj.history.unshift(historyEntry);
        if (fieldObj.history.length > 50) fieldObj.history = fieldObj.history.slice(0, 50);
        this.renderHistory();
    }
 
    restoreFromHistory(historyItem, field = this.activeField) {
        const fieldObj = this.fields[field];
        
        // Hide overlay immediately when restoring from history
        fieldObj.overlayHidden = true;
        this.updateHighlights(field);
        
        // Handle both old format (string) and new format (object)
        const text = typeof historyItem === 'string' ? historyItem : historyItem.text;
        const llmResult = typeof historyItem === 'object' ? historyItem.llmLastResult : null;
        
        // Restore database IDs if available
        if (typeof historyItem === 'object') {
            fieldObj.userInputId = historyItem.userInputId || null;
            fieldObj.rewriteUuid = historyItem.rewriteUuid || null;
            fieldObj.reviewId = historyItem.reviewId || null;
        }
        
        // Restore the text
        fieldObj.editor.innerHTML = '&nbsp;'; // Force not empty for CSS
        fieldObj.editor.innerText = text;
        fieldObj.editor.classList.remove('empty');
        fieldObj.editor.textContent = text; // Redundant but for robustness
        fieldObj.editor.offsetHeight; // Force reflow
        fieldObj.editor.focus();
 
        // Restore the evaluation and feedback if available
        if (llmResult) {
            fieldObj.llmLastResult = llmResult;
            fieldObj.isRestoringFromHistory = true; // Flag to indicate history restoration
            const hasRewrite = llmResult.rewrite || llmResult.rewritten_problem_statement;
            this.displayLLMResult(llmResult, hasRewrite, field);
        } else {
            fieldObj.llmLastResult = null;
            const evalBox = document.getElementById('llm-eval-box');
            if (evalBox) { evalBox.innerHTML = ''; evalBox.style.display = 'none'; }
            const rewritePopup = document.getElementById('rewrite-popup');
            if (rewritePopup) { rewritePopup.style.display = 'none'; }
        }
        this.updateEditorLabelsWithScore();
        this.updateActiveEditorHighlight();
        this.checkText(field);
        // Overlay will be shown again when checkText completes and calls updateHighlights
    }
 
    renderHistory() {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';
        // Update the history header dynamically
        const historyHeader = document.querySelector('.history-header');
        let label = '';
        if (this.activeField === 'editor') {
            label = 'Current Problem Statement History';
        } else if (this.activeField === 'editor2') {
            label = 'Daily FSR Notes History';
        } else {
            label = 'Input History';
        }
        if (historyHeader) historyHeader.textContent = label;
        
        const fieldObj = this.fields[this.activeField];
        if (!fieldObj.history || fieldObj.history.length === 0) {
            this.historyList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">Previous versions will appear here after submission</div>';
            return;
        }
        
        fieldObj.history.forEach((item, index) => {
            const historyItem = document.createElement('li');
            historyItem.className = 'history-item';
            historyItem.title = 'Click to revert to this version';
            
            const text = typeof item === 'string' ? item : item.text;
            const llmResult = typeof item === 'object' ? item.llmLastResult : null;
            
            // Calculate score if available and set border color to a discrete bucket matching the temperature bar palette
            if (llmResult && llmResult.evaluation) {
                const score = this.calculateWeightedScore(this.activeField, llmResult.evaluation);
                const percentage = Math.round(score);
                // Discrete buckets aligned with the temperature bar gradient
                // 0–20: red, 21–40: orange-red, 41–60: yellow, 61–80: yellow-green, 81–100: green
                let borderColor = '#e8eaed';
                if (percentage <= 20) {
                    borderColor = '#ff6b6b';
                } else if (percentage <= 40) {
                    borderColor = '#ff9f43';
                } else if (percentage <= 60) {
                    borderColor = '#ffd93d';
                } else if (percentage <= 80) {
                    borderColor = '#a8e063';
                } else {
                    borderColor = '#6bcf7f';
                }
                historyItem.style.border = `2px solid ${borderColor}`;
            }
            
            // Replace newlines with <br> tags for proper rendering
            const textWithNewlines = text.replace(/\n/g, '<br>');
            
            // Add CRM source indicator if this is from CRM
            let sourceIndicator = '';
            let fsrFooter = '';
            if (typeof item === 'object' && item.crmSource) {
                // Format date properly from FSR Creation Date
                let formattedDate = item.creationDate;
                if (item.creationDate) {
                    try {
                        // Try to parse the date and format it nicely
                        const date = new Date(item.creationDate);
                        if (!isNaN(date.getTime())) {
                            formattedDate = date.toLocaleDateString('en-US', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric'
                            });
                        }
                    } catch (e) {
                        // If parsing fails, just use the original date
                        formattedDate = item.creationDate;
                    }
                }
                
                // Check if this is a grouped entry with multiple FSR numbers
                if (item.fsrNumbers && Array.isArray(item.fsrNumbers) && item.fsrNumbers.length > 0) {
                    // Multiple FSR numbers (grouped duplicates)
                    const fsrCount = item.fsrNumbers.length;
                    const fsrList = item.fsrNumbers.join(', ');
                    
                    sourceIndicator = `<div style="font-size: 11px; color: #666; margin-bottom: 4px; font-weight: bold;">
                        📋 CRM Data (${formattedDate})
                    </div>`;
                    
                    fsrFooter = `<div style="font-size: 10px; color: #888; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e0e0e0;">
                        Used in ${fsrCount} FSR${fsrCount > 1 ? 's' : ''}: ${fsrList}
                    </div>`;
                } else {
                    // Single FSR number (backwards compatibility)
                    sourceIndicator = `<div style="font-size: 11px; color: #666; margin-bottom: 4px; font-weight: bold;">
                        📋 CRM Data - FSR ${item.fsrNumber} (${formattedDate})
                    </div>`;
                }
            }
            
            historyItem.innerHTML = `
                ${sourceIndicator}
                <div style="white-space:pre-wrap;">${textWithNewlines}</div>
                ${fsrFooter}
            `;
            
            historyItem.onclick = () => {
                this.restoreFromHistory(item, this.activeField);
            };
            
            this.historyList.appendChild(historyItem);
        });
    }
 
    // When switching boxes, always clear rewrite result if it was just shown
    renderEvaluationAndRewrite(field) {
        // Defensive: clear right side first to avoid flicker of wrong data
        const evalBox = document.getElementById('llm-eval-box');
        if (evalBox) {
            evalBox.innerHTML = '';
            evalBox.style.display = 'none';
        }
        
        // Save current rewrite answers before hiding popup
        const rewritePopup = document.getElementById('rewrite-popup');
        if (rewritePopup && rewritePopup.style.display !== 'none') {
            const currentField = this.activeField;
            const currentFieldObj = this.fields[currentField];
            if (currentFieldObj && currentFieldObj.llmQuestions) {
                const answerEls = rewritePopup.querySelectorAll('.rewrite-answer');
                answerEls.forEach(el => {
                    const crit = el.getAttribute('data-criteria');
                    if (crit) {
                        currentFieldObj.llmAnswers[crit] = el.value;
                    }
                });
            }
            rewritePopup.style.display = 'none';
        }
        
        // Only show evaluation if this is the active field
        if (field === this.activeField) {
            const fieldObj = this.fields[field];
            // If the last result was a rewrite, and the editor content doesn't match, clear it
            if (fieldObj.llmLastResult && fieldObj.llmLastResult.rewrite && fieldObj.llmLastResult.original_text !== fieldObj.editor.innerText) {
                fieldObj.llmLastResult = null;
            }
            // Don't show evaluation if the field is currently being reviewed
            if (fieldObj.llmInProgress) {
                return;
            }
            if (fieldObj.llmLastResult) {
                // Always show evaluation if there's a result, regardless of original_text matching
                // This ensures restored history items always show their evaluation
                this.displayLLMResult(fieldObj.llmLastResult, false, field);
            }
        }
        
        this.updateActiveEditorHighlight(); // Always re-apply highlight after UI update
    }
 
    // Render only the evaluation part without affecting the rewrite popup
    renderEvaluationOnly(result, field = this.activeField) {
        const fieldObj = this.fields[field];
        const evalBox = document.getElementById('llm-eval-box');
        if (!evalBox) return;
        
        let html = '';
        let valid = result && typeof result === 'object';
        let rulesObj = result && result.evaluation ? result.evaluation : result;
        
        // Collapsible state (per field)
        if (!this.evalCollapsed) this.evalCollapsed = {};
        if (typeof this.evalCollapsed[field] === 'undefined') this.evalCollapsed[field] = true; // Collapsed by default
        const isCollapsed = this.evalCollapsed[field];
        
        if (valid && rulesObj && typeof rulesObj === 'object') {
            const keys = Object.keys(rulesObj);
            const total = keys.length;
            const passed = keys.filter(key => rulesObj[key].passed).length;
            let inputType = 'How Your Score Was Calculated';
            
            // Replace score box with feedback title
            html += `<div class="llm-score" style="font-size:1.35em;font-weight:700;margin-bottom:0;background:#fff;color:#41007F;padding:10px 0 10px 0;border-radius:8px;text-align:center;box-shadow:0 1px 4px rgba(33,0,127,0.07);letter-spacing:0.5px;display:flex;align-items:center;justify-content:center;gap:10px;position:relative;">\n` +
                `<button id="eval-collapse-btn" title="Click to expand for details" style="background:rgba(65,0,127,0.05);border:none;cursor:pointer;padding:0 6px;outline:none;display:inline-flex;align-items:center;justify-content:center;position:absolute;left:8px;top:50%;width:24px;height:24px;z-index:2;border-radius:4px;transition:background 0.2s ease;">\n` +
                `<span id="eval-chevron" style="font-size:1.3em;">▶</span>\n` +
                `</button>\n` +
                `<span style="margin-left:32px;font-size:1.5em;">${inputType}</span>\n` +
                `</div>`;
            // Only show the rest if not collapsed
            if (!isCollapsed) {
                // Sort rules: passed first, then failed
                const sortedKeys = keys.sort((a, b) => {
                    const aPassed = rulesObj[a].passed;
                    const bPassed = rulesObj[b].passed;
                    if (aPassed === bPassed) return 0;
                    return aPassed ? -1 : 1;
                });
                
                sortedKeys.forEach(key => {
                    const section = rulesObj[key];
                    const isPassed = section.passed;
                    const passedClass = isPassed ? 'passed' : 'failed';
                    const passedText = isPassed ? 'Completed' : 'Needs Improvement';
                    const passedColor = isPassed ? '#4CAF50' : '#F44336';
                    
                    html += `<div class="llm-section ${passedClass}" data-passed="${isPassed}">\n`;
                    html += `<div class="llm-section-header">\n`;
                    html += `<div class="llm-section-title" data-criteria="${key}" style="cursor:pointer;font-weight:600;font-size:1.1em;color:#333;margin-bottom:4px;display:flex;align-items:center;gap:8px;">\n`;
                    html += `<span style="color:${passedColor};font-weight:700;">${passedText}</span>\n`;
                    html += `<span style="color:#666;font-weight:400;">${this.escapeHtml(section.name || key)}</span>\n`;
                    html += `</div>\n`;
                    html += `<div class="llm-dropdown-arrow" style="color:#666;font-size:0.9em;transition:transform 0.2s;">▶</div>\n`;
                    html += `</div>\n`;
                    html += `<div class="llm-section-justification" style="display:none;margin-top:8px;padding:8px;background:#f9f9f9;border-radius:4px;font-size:0.9em;color:#666;line-height:1.4;">\n`;
                    html += `${this.escapeHtml(section.justification || 'No justification provided.')}\n`;
                    html += `</div>\n`;
                    if (!isPassed) {
                        html += `<button class="llm-feedback-btn" data-criteria="${key}" style="margin-top:8px;background:#41007F;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:0.8em;">Give Feedback</button>\n`;
                    }
                    html += `</div>\n`;
                });
            }
        }
        
        evalBox.innerHTML = html;
        evalBox.style.display = 'flex';
        
        // Re-add collapse/expand logic
        const collapseBtn = document.getElementById('eval-collapse-btn');
        if (collapseBtn) {
            collapseBtn.onclick = () => {
                this.evalCollapsed[field] = !this.evalCollapsed[field];
                
                // Instead of regenerating HTML, just toggle the class and show/hide content
                collapseBtn.classList.toggle('collapsed', this.evalCollapsed[field]);
                
                const evalBox = document.getElementById('llm-eval-box');
                if (evalBox) {
                    const content = evalBox.querySelector('.llm-eval-content');
                    if (content) {
                        const newDisplay = this.evalCollapsed[field] ? 'none' : 'block';
                        content.style.display = newDisplay;
                    }
                }
            };
            // Set initial state
            collapseBtn.classList.toggle('collapsed', this.evalCollapsed[field]);
        }
        
        // Re-add all the other event listeners (dropdowns, feedback buttons, etc.)
        this.addEvaluationEventListeners(field);
    }
 
    // Add event listeners for evaluation elements
    addEvaluationEventListeners(field) {
        const fieldObj = this.fields[field];
        const evalBox = document.getElementById('llm-eval-box');
        if (!evalBox) return;
        
        // Dropdown logic
        const dropdowns = evalBox.querySelectorAll('.llm-dropdown');
        dropdowns.forEach((dropdown, index) => {
            const header = dropdown.querySelector('.llm-section-header');
            const justification = dropdown.querySelector('.llm-section-justification');
            const arrow = dropdown.querySelector('.llm-dropdown-arrow');
            
            // Set initial state
            if (dropdown.classList.contains('open')) {
                justification.style.display = 'block';
                arrow.classList.add('open');
            } else {
                justification.style.display = 'none';
                arrow.classList.remove('open');
            }
            // Toggle on click or enter/space
            header.addEventListener('click', (e) => {
                dropdown.classList.toggle('open');
                const isOpen = dropdown.classList.contains('open');
                justification.style.display = isOpen ? 'block' : 'none';
                arrow.classList.toggle('open', isOpen);
            });
            header.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    header.click();
                }
            });
        });
 
        // Add click handlers for evaluation titles to navigate to rewrite box (only for failed evaluations)
        const failedTitleElements = evalBox.querySelectorAll('.llm-dropdown[data-passed="false"] .llm-section-title');
        failedTitleElements.forEach(title => {
            title.addEventListener('click', (e) => {
                const criteria = title.getAttribute('data-criteria');
                const rewritePopup = document.getElementById('rewrite-popup');
                let handled = false;
                // Check if rewrite popup is visible and has questions
                if (rewritePopup && rewritePopup.style.display !== 'none') {
                    // Find the corresponding textarea for this criteria
                    const textarea = rewritePopup.querySelector(`textarea[data-criteria="${criteria}"]`);
                    if (textarea) {
                        // Scroll to the textarea and focus it
                        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => {
                            textarea.focus();
                        }, 300);
                        handled = true;
                    }
                }
                if (handled) e.stopPropagation();
            });
        });
 
        const feedbackBtns = evalBox.querySelectorAll('.llm-feedback-btn');
        feedbackBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const criteria = btn.getAttribute('data-criteria');
                const text = fieldObj.editor.innerText;
                // Toggle feedback box
                const card = btn.closest('.llm-section');
                if (!card) return;
                let feedbackBox = card.querySelector('.llm-feedback-box');
                if (feedbackBox) {
                    // Close existing box and unselect button (no submit)
                    feedbackBox.remove();
                    const spacer = card.querySelector('.llm-feedback-space');
                    if (spacer) spacer.remove();
                    btn.classList.remove('selected');
                    return;
                }
 
                // Open a new feedback box and mark selected
                btn.classList.add('selected');
                    feedbackBox = document.createElement('div');
                    feedbackBox.className = 'llm-feedback-box';
                    feedbackBox.style.marginTop = '0px';
                    feedbackBox.innerHTML = `<textarea class="llm-feedback-text" rows="1" placeholder="Please Give Feedback"></textarea><button class="llm-feedback-submit" title="Send Feedback"> <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><line x1='22' y1='2' x2='11' y2='13'/><polygon points='22 2 15 22 11 13 2 9 22 2'/></svg></button>`;
                    card.appendChild(feedbackBox);
                    // Add vertical space below feedback box
                    const feedbackSpace = document.createElement('div');
                feedbackSpace.className = 'llm-feedback-space';
                    feedbackSpace.style.height = '12px';
                    card.appendChild(feedbackSpace);
                    const submitBtn = feedbackBox.querySelector('.llm-feedback-submit');
                    submitBtn.addEventListener('click', () => {
                        const feedbackText = feedbackBox.querySelector('.llm-feedback-text').value;
                        // Find pass/fail for this criteria
                        let passed = null;
                        if (fieldObj.llmLastResult && fieldObj.llmLastResult.evaluation && fieldObj.llmLastResult.evaluation[criteria]) {
                            passed = fieldObj.llmLastResult.evaluation[criteria].passed;
                        }
                        // Build IDs: rewrite_id (from criteria map) and user_input_id (from last rewrite mapping)
                        const rewriteId = (fieldObj.rewriteIdByCriteria && fieldObj.rewriteIdByCriteria[criteria]) ? fieldObj.rewriteIdByCriteria[criteria] : null;
                        // Prefer user_input_id provided with the evaluation (step 1)
                        let userInputId = fieldObj.userInputId || null;
                        if (!userInputId && Array.isArray(fieldObj.lastRewriteUserInputs) && rewriteId) {
                            const match = fieldObj.lastRewriteUserInputs.find(u => String(u.rewrite_id) === String(rewriteId));
                            if (match && (match.user_input_id || match.id)) {
                                userInputId = match.user_input_id || match.id;
                            }
                        }
                        // Send feedback to backend using schema-aligned payload
                        fetch('/feedback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                criteria,
                                text,
                                feedback: 'thumbs_down',
                                explanation: feedbackText,
                                passed,
                                rewrite_id: rewriteId,
                                user_input_id: userInputId
                            })
                        }).then(res => res.json()).then(data => {
                            this.logDb('EVALUATION_FEEDBACK insert', {
                                criteria,
                                text,
                                feedback: 'thumbs_down',
                                explanation: feedbackText,
                                passed,
                                rewrite_id: rewriteId,
                                user_input_id: userInputId
                            });
                            btn.classList.add('selected');
                            btn.title = "Feedback received!";
                            feedbackBox.remove();
                            feedbackSpace.remove();
                            
                            // Move evaluation to completed and update score
                            if (fieldObj.llmLastResult && fieldObj.llmLastResult.evaluation && fieldObj.llmLastResult.evaluation[criteria]) {
                                fieldObj.llmLastResult.evaluation[criteria].passed = true;
                                this.updateEditorLabelsWithScore();
                                this.displayLLMResult(fieldObj.llmLastResult, false, field);
                            }
                        });
                    });
                    // Prevent newlines in feedback box
                    const feedbackTextarea = feedbackBox.querySelector('.llm-feedback-text');
                    feedbackTextarea.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            feedbackTextarea.blur();
                        }
                    });
            });
        });
    }
    
    // Update button state to show progress
    updateButtonState(field, state) {
        const fieldObj = this.fields[field];
        const submitBtn = fieldObj.submitBtn;
        const rewriteBtn = document.getElementById('submit-answers-btn');
        
        if (state === 'reviewing') {
            if (submitBtn) {
                submitBtn.textContent = 'Reviewing...';
                submitBtn.disabled = true;
                submitBtn.style.backgroundColor = '#41007F';
                submitBtn.style.color = 'white';
                submitBtn.style.cursor = 'not-allowed';
                submitBtn.classList.add('button-processing');
            }
        } else if (state === 'rewriting') {
            if (rewriteBtn) {
                rewriteBtn.textContent = 'Rewriting...';
                rewriteBtn.disabled = true;
                rewriteBtn.style.backgroundColor = '#41007F';
                rewriteBtn.style.color = 'white';
                rewriteBtn.style.cursor = 'not-allowed';
                rewriteBtn.classList.add('button-processing');
            }
        }
    }
    
    // Reset button state to normal
    resetButtonState(field) {
        const fieldObj = this.fields[field];
        const submitBtn = fieldObj.submitBtn;
        const rewriteBtn = document.getElementById('submit-answers-btn');
        
        if (submitBtn) {
            submitBtn.textContent = 'Submit for Review';
            submitBtn.disabled = false;
            submitBtn.style.backgroundColor = '';
            submitBtn.style.color = '';
            submitBtn.style.cursor = 'pointer';
            submitBtn.classList.remove('button-processing');
        }
        
        if (rewriteBtn) {
            rewriteBtn.textContent = 'Rewrite';
            rewriteBtn.disabled = false;
            rewriteBtn.style.backgroundColor = '';
            rewriteBtn.style.color = '';
            rewriteBtn.style.cursor = 'pointer';
            rewriteBtn.classList.remove('button-processing');
        }
    }
    
    // Note: Database logging is now handled entirely by the backend /llm endpoint
    // This prevents duplicate rows in LLM_EVALUATION table
}
 
// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.spellCheckEditor = new LanguageToolEditor();
    const editor = document.getElementById('editor');
    if (editor) {
                    editor.setAttribute('data-placeholder', 'Start typing your current problem statement here');
    }
});

// Case Management System
class CaseManager {
    constructor() {
        this.cases = [];
        this.currentCase = null;
        this.caseCounter = 1;
        this.userId = null;
        this.preloadedSuggestions = []; // Cache for case suggestions
        // Don't call init() here - will be called from outside
    }
    
    async init() {
        console.log('🚀 Initializing CaseManager...');
        
        // Show loading indicator
        this.showLoadingIndicator();
        
        await this.fetchUserInfo();
        console.log('✅ User info fetched, userId:', this.userId);
        
        // Step 1: Load database cases first (fast) - this unlocks the UI
        await this.loadCases();
        console.log('✅ Cases loaded from database');
        
        // Step 2: Setup UI and unlock the site
        this.setupEventListeners();
        this.renderCasesList();
        this.startAutoSave();
        
        // Hide loading indicator - user can now use the site
        this.hideLoadingIndicator();
        console.log('✅ Site is now usable - database cases loaded');
        
        // Check if there are no cases and show placeholder if needed
        if (this.cases.length === 0) {
            console.log('📄 [CaseManager] No cases found on init, showing no cases placeholder');
            this.clearAllEditorsAndUI();
        }
        
        // Step 3: Preload CRM cases in background (slow - don't block UI)
        // This happens after the site is usable, so user doesn't wait
        this.preloadCaseSuggestions().then(() => {
            console.log('✅ CRM case suggestions preloaded in background');
        }).catch((error) => {
            console.error('❌ Error preloading CRM suggestions in background:', error);
        });
        
        // Step 4: Check for closed cases in background (non-blocking)
        this.checkForClosedCases().then(() => {
            console.log('✅ Closed cases check completed in background');
        }).catch((error) => {
            console.error('❌ Error checking closed cases in background:', error);
        });
        
        console.log('✅ CaseManager initialization complete - site ready');
    }
    
    async fetchUserInfo() {
        try {
            const response = await fetch('/user');
            if (response.ok) {
                const userData = await response.json();
                this.userId = userData.user_id;
                console.log('==============================================');
                console.log('LOGGED IN USER ID:', this.userId);
                console.log('User Data:', userData);
                console.log('==============================================');
                
                // Show user ID in UI temporarily for debugging
                const alert_msg = `Logged in as User ID: ${this.userId}\n` +
                                `Name: ${userData.first_name} ${userData.last_name}\n` +
                                `Email: ${userData.email || 'PRUTHVI.VENKATASEERAMREDDI@KLA.COM'}`;
                console.log(alert_msg);
            } else {
                console.error('Failed to fetch user info');
                this.userId = 'guest'; // Fallback
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            this.userId = 'guest'; // Fallback
        }
    }
    
    async preloadCaseSuggestions() {
        try {
            console.log('🔍 [CaseManager] Preloading case suggestions from CRM database...');
            const response = await fetch('/api/cases/suggestions/preload');
            if (response.ok) {
                const data = await response.json();
                this.preloadedSuggestions = data.case_numbers || [];
                const totalCases = this.preloadedSuggestions.length;
                const filteredByEmail = data.filtered_by_email || 'unknown';
                console.log(`✅ [CaseManager] Preloaded ${totalCases} case suggestions from CRM database (filtered by user email: ${filteredByEmail})`);
                console.log(`📊 [CaseManager] Total preloaded cases from CRM database: ${totalCases}`);
                console.log(`🔒 [CaseManager] All ${totalCases} cases are pre-filtered by email: ${filteredByEmail}`);
                
                // Log sample of 5 case numbers for testing
                if (totalCases > 0) {
                    const sampleCount = Math.min(5, totalCases);
                    const sampleCases = this.preloadedSuggestions.slice(0, sampleCount);
                    console.log(`🔍 [CaseManager] Sample preloaded case numbers from CRM (first ${sampleCount} of ${totalCases}):`, sampleCases);
                    console.log(`📋 [CaseManager] Using ${totalCases} cases from CRM database for suggestions (all filtered by email: ${filteredByEmail})`);
                } else {
                    console.log(`⚠️ [CaseManager] No cases found in CRM database for preloading`);
                }
            } else {
                console.error('❌ [CaseManager] Failed to preload suggestions:', response.status);
                this.preloadedSuggestions = [];
            }
        } catch (error) {
            console.error('❌ [CaseManager] Error preloading suggestions:', error);
            this.preloadedSuggestions = [];
        }
    }
    
    showLoadingIndicator() {
        // Create loading overlay
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'case-loading-overlay';
        loadingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            backdrop-filter: blur(4px);
        `;
        
        loadingOverlay.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="width: 40px; height: 40px; border: 4px solid #e5e7eb; border-top: 4px solid #41007F; 
                     border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                <div style="font-size: 16px; font-weight: 600; color: #374151; margin-bottom: 8px;">Loading Cases</div>
                <div style="font-size: 14px; color: #6b7280;">Fetching your cases and CRM data...</div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        
        document.body.appendChild(loadingOverlay);
    }
    
    hideLoadingIndicator() {
        const loadingOverlay = document.getElementById('case-loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.remove();
        }
    }
    
    showCaseLoadingIndicator(message = 'Loading...') {
        // Create loading overlay for case switching
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'case-switch-loading-overlay';
        loadingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9998;
            backdrop-filter: blur(3px);
        `;
        
        loadingOverlay.innerHTML = `
            <div style="text-align: center; padding: 30px;">
                <div style="width: 50px; height: 50px; border: 4px solid #e5e7eb; border-top: 4px solid #41007F; 
                     border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px;"></div>
                <div style="font-size: 16px; font-weight: 600; color: #374151;">${message}</div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        
        document.body.appendChild(loadingOverlay);
    }
    
    hideCaseLoadingIndicator() {
        const loadingOverlay = document.getElementById('case-switch-loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.remove();
        }
    }
    
    showFeedbackLoadingOverlay() {
        // Create loading overlay for feedback popup
        const feedbackContent = document.querySelector('.feedback-content');
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'feedback-loading-overlay';
        loadingOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            backdrop-filter: blur(2px);
        `;
        
        loadingOverlay.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="width: 40px; height: 40px; border: 4px solid #e5e7eb; border-top: 4px solid #41007F; 
                     border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                <div style="font-size: 16px; font-weight: 600; color: #374151; margin-bottom: 8px;">Generating Feedback</div>
                <div style="font-size: 14px; color: #6b7280;">AI is analyzing the case and generating symptom, fault, and fix...</div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        
        feedbackContent.appendChild(loadingOverlay);
    }
    
    hideFeedbackLoadingOverlay() {
        const loadingOverlay = document.getElementById('feedback-loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.remove();
        }
    }
    
    showFeedbackValidationError(message) {
        // Remove any existing error message
        const existingError = document.getElementById('feedback-validation-error');
        if (existingError) {
            existingError.remove();
        }
        
        // Create full popup error overlay
        const errorDiv = document.createElement('div');
        errorDiv.id = 'feedback-validation-error';
        errorDiv.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(254, 242, 242, 0.95);
            border: 2px solid #fecaca;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 1001;
            backdrop-filter: blur(2px);
            animation: feedbackErrorSlideIn 0.3s ease-out;
        `;
        errorDiv.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="width: 60px; height: 60px; background: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                    <div style="color: white; font-size: 24px; font-weight: bold;">!</div>
                </div>
                <div style="font-size: 18px; font-weight: 600; color: #dc2626; margin-bottom: 12px;">Validation Error</div>
                <div style="font-size: 16px; color: #991b1b; margin-bottom: 20px;">${message}</div>
                <button onclick="this.closest('#feedback-validation-error').remove()" style="
                    background: #dc2626;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">
                    Dismiss
                </button>
            </div>
        `;
        
        // Insert into feedback content
        const feedbackContent = document.querySelector('.feedback-content');
        feedbackContent.appendChild(errorDiv);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.style.animation = 'feedbackErrorSlideOut 0.3s ease-in';
                setTimeout(() => errorDiv.remove(), 300);
            }
        }, 8000);
    }
    
    showFeedbackSuccessMessage(message) {
        // Remove any existing messages
        const existingError = document.getElementById('feedback-validation-error');
        const existingSuccess = document.getElementById('feedback-success-message');
        if (existingError) existingError.remove();
        if (existingSuccess) existingSuccess.remove();
        
        // Create full popup success overlay
        const successDiv = document.createElement('div');
        successDiv.id = 'feedback-success-message';
        successDiv.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(240, 253, 244, 0.95);
            border: 2px solid #bbf7d0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 1001;
            backdrop-filter: blur(2px);
            animation: feedbackSuccessSlideIn 0.3s ease-out;
        `;
        successDiv.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="width: 60px; height: 60px; background: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                    <div style="color: white; font-size: 24px; font-weight: bold;">✓</div>
                </div>
                <div style="font-size: 18px; font-weight: 600; color: #166534; margin-bottom: 12px;">Success!</div>
                <div style="font-size: 16px; color: #15803d; margin-bottom: 20px;">${message}</div>
                <div style="font-size: 14px; color: #16a34a;">Moving to next case...</div>
            </div>
        `;
        
        // Insert into feedback content
        const feedbackContent = document.querySelector('.feedback-content');
        feedbackContent.appendChild(successDiv);
        
        // Auto-remove after 2 seconds (will be handled by submitFeedback timeout)
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.style.animation = 'feedbackSuccessSlideOut 0.3s ease-in';
                setTimeout(() => successDiv.remove(), 300);
            }
        }, 2000);
    }
    
    async showDeleteConfirmation(caseToDelete) {
        return new Promise((resolve) => {
            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            `;
            
            // Create modal content
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: white;
                padding: 0;
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
                max-width: 500px;
                width: 90%;
                overflow: hidden;
                border: 1px solid #e1e5e9;
            `;
            
            const caseName = caseToDelete.caseTitle || `Case ${caseToDelete.caseNumber}`;
            
            modal.innerHTML = `
                <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 24px; color: white; position: relative;">
                    <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                    <h3 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600;">Delete Case</h3>
                    <p style="margin: 0; opacity: 0.9; font-size: 14px;">This action cannot be undone</p>
                </div>
                <div style="padding: 32px;">
                    <div style="margin-bottom: 24px;">
                        <div style="font-size: 16px; color: #374151; margin-bottom: 8px;">
                            <strong>Case Number:</strong> ${caseToDelete.caseNumber}
                        </div>
                        <div style="font-size: 16px; color: #374151; margin-bottom: 16px;">
                            <strong>Case Name:</strong> ${caseName}
                        </div>
                        <div style="font-size: 14px; color: #6b7280; background: #f9fafb; padding: 16px; border-radius: 8px; border-left: 4px solid #dc2626;">
                            Are you sure you want to delete this case? All associated data including problem statements, FSR notes, and history will be permanently removed.
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                        <button id="cancel-delete-btn" style="padding: 12px 24px; border: 1px solid #d1d5db; background: #f9fafb; 
                                color: #374151; border-radius: 8px; cursor: pointer; font-weight: 500; 
                                transition: all 0.2s ease; font-size: 14px;">Cancel</button>
                        <button id="confirm-delete-btn" style="padding: 12px 24px; background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); 
                                color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; 
                                transition: all 0.2s ease; font-size: 14px;">Delete Case</button>
                    </div>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            const cancelBtn = modal.querySelector('#cancel-delete-btn');
            const confirmBtn = modal.querySelector('#confirm-delete-btn');
            
            // Button handlers
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(false);
            });
            
            confirmBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(true);
            });
            
            // Add hover effects
            cancelBtn.addEventListener('mouseenter', () => {
                cancelBtn.style.background = '#f3f4f6';
                cancelBtn.style.borderColor = '#9ca3af';
            });
            
            cancelBtn.addEventListener('mouseleave', () => {
                cancelBtn.style.background = '#f9fafb';
                cancelBtn.style.borderColor = '#d1d5db';
            });
            
            confirmBtn.addEventListener('mouseenter', () => {
                confirmBtn.style.transform = 'translateY(-1px)';
                confirmBtn.style.boxShadow = '0 4px 12px rgba(220, 38, 38, 0.3)';
            });
            
            confirmBtn.addEventListener('mouseleave', () => {
                confirmBtn.style.transform = 'translateY(0)';
                confirmBtn.style.boxShadow = 'none';
            });
        });
    }
    
    setupEventListeners() {
        // New case button
        const newCaseBtn = document.getElementById('new-case-btn');
        if (newCaseBtn) {
            newCaseBtn.addEventListener('click', () => this.createNewCase());
        }
        
        // Active case box - clicking toggles sidebar
        const activeCaseBox = document.getElementById('active-case-box');
        const sidebar = document.querySelector('.cases-sidebar');
        const closeSidebarBtn = document.getElementById('close-sidebar-btn');
        const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
        
        if (activeCaseBox && sidebar) {
            // Start with sidebar open by default on desktop, collapsed on mobile
            const savedState = localStorage.getItem('sidebar-collapsed');
            const isCollapsed = savedState === 'true' || (savedState === null && window.innerWidth <= 950);
            if (isCollapsed) {
                sidebar.classList.add('collapsed');
            }
            
            activeCaseBox.addEventListener('click', () => {
                const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
                
                if (isCurrentlyCollapsed) {
                    // Expand
                    sidebar.classList.remove('collapsed');
                    localStorage.setItem('sidebar-collapsed', 'false');
                } else {
                    // Collapse
                    sidebar.classList.add('collapsed');
                    localStorage.setItem('sidebar-collapsed', 'true');
                }
            });
        }
        
        // Header sidebar toggle button
        if (sidebarToggleBtn && sidebar) {
            sidebarToggleBtn.addEventListener('click', () => {
                const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
                
                if (isCurrentlyCollapsed) {
                    // Expand
                    sidebar.classList.remove('collapsed');
                    localStorage.setItem('sidebar-collapsed', 'false');
                } else {
                    // Collapse
                    sidebar.classList.add('collapsed');
                    localStorage.setItem('sidebar-collapsed', 'true');
                }
            });
        }
        
        // Close sidebar button
        if (closeSidebarBtn && sidebar) {
            closeSidebarBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling
                sidebar.classList.add('collapsed');
                localStorage.setItem('sidebar-collapsed', 'true');
            });
        }
        
        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (sidebar && !sidebar.classList.contains('collapsed')) {
                if (!sidebar.contains(e.target) && !activeCaseBox.contains(e.target)) {
                    // Don't auto-close on desktop, only on mobile
                    if (window.innerWidth <= 950) {
                        sidebar.classList.add('collapsed');
                        localStorage.setItem('sidebar-collapsed', 'true');
                    }
                }
            }
        });
    }
    
    async loadCases(forceRefresh = false) {
        if (this.userId === null || this.userId === undefined) {
            console.warn('⚠️ [CaseManager] No user ID available, cannot load cases');
            this.cases = [];
            return;
        }
        
        console.log(`🚀 [CaseManager] Loading cases for user ${this.userId} from database... (forceRefresh: ${forceRefresh})`);
        
        try {
            // Parallelize Step 1 and Step 2 - they query similar data and can run concurrently
            console.log('📋 [CaseManager] Fetching user cases and case data in parallel...');
            const cacheBust = Date.now();
            
            const [userCasesResponse, caseDataResponse] = await Promise.all([
                fetch(`/api/cases/user-cases?cache_bust=${cacheBust}`),
                fetch(`/api/cases/data?cache_bust=${cacheBust}`)
            ]);
            
            if (!userCasesResponse.ok) {
                throw new Error(`Failed to fetch user cases: ${userCasesResponse.status} ${userCasesResponse.statusText}`);
            }
            
            if (!caseDataResponse.ok) {
                throw new Error(`Failed to fetch case data: ${caseDataResponse.status} ${caseDataResponse.statusText}`);
            }
            
            const [userCasesData, caseData] = await Promise.all([
                userCasesResponse.json(),
                caseDataResponse.json()
            ]);
            
            // Convert backend format to frontend format
            const backendCases = caseData.cases || {};
            console.log(`📊 [CaseManager] Processing ${Object.keys(backendCases).length} cases from database`);
            
            this.cases = Object.values(backendCases).map(caseData => {
                const caseInfo = {
                    id: caseData.caseNumber, // Use case number as ID for consistency
                    caseNumber: caseData.caseNumber,
                    caseTitle: caseData.caseTitle || null, // Use case title from database
                    problemStatement: caseData.problemStatement || '',
                    fsrNotes: caseData.fsrNotes || '',
                    createdAt: new Date(caseData.updatedAt || Date.now()),
                    updatedAt: new Date(caseData.updatedAt || Date.now()),
                    isTrackedInDatabase: true // All cases from database are tracked
                };
                
                return caseInfo;
            });
            
            console.log(`✅ [CaseManager] Successfully loaded ${this.cases.length} cases from database`);
            console.log(`📊 [CaseManager] Case titles from DB:`, this.cases.map(c => ({ caseNumber: c.caseNumber, caseTitle: c.caseTitle })));
            
            // Only load CRM data for cases that don't have titles in the database
            const casesNeedingTitles = this.cases.filter(caseData => caseData.caseNumber && !caseData.caseTitle);
            
            if (casesNeedingTitles.length > 0) {
                console.log(`🔍 [CaseManager] Loading CRM data for ${casesNeedingTitles.length} cases missing titles...`);
                const crmLoadPromises = casesNeedingTitles.map(caseData => this.loadCRMDataAndPopulateHistory(caseData.caseNumber));
                
                await Promise.all(crmLoadPromises);
                console.log(`✅ [CaseManager] Loaded CRM data for ${casesNeedingTitles.length} cases`);
                console.log(`📊 [CaseManager] Cases after CRM load:`, this.cases.map(c => ({ id: c.id, caseNumber: c.caseNumber, caseTitle: c.caseTitle })));
                
                // Wait a moment for async saves to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                console.log(`⏱️ [CaseManager] Waited for case title saves to complete`);
            } else {
                console.log(`✅ [CaseManager] All ${this.cases.length} cases already have titles from database, skipping CRM load`);
            }
            
            // Re-render to show updated case titles
            this.renderCasesList();
            
            // Also sync with localStorage for offline access
            this.saveCasesLocally();
            console.log('💾 [CaseManager] Cases synced to localStorage for offline access');
            
        } catch (error) {
            console.error('❌ [CaseManager] Error loading cases from database:', error);
            console.log('🔄 [CaseManager] Falling back to localStorage...');
            // Fallback to localStorage
            this.loadCasesFromLocalStorage();
        }
        
        // Set first case as current if none selected
        if (this.cases.length > 0 && !this.currentCase) {
            console.log(`🎯 [CaseManager] Setting current case to: ${this.cases[0].caseNumber} (ID: ${this.cases[0].id})`);
            console.log(`🎯 [CaseManager] Available cases:`, this.cases.map(c => ({ id: c.id, caseNumber: c.caseNumber })));
            this.switchToCase(this.cases[0].id);
        }
    }
    
    async refreshCases() {
        console.log('🔄 [CaseManager] Force refreshing cases from database...');
        await this.loadCases(true);
        this.renderCasesList();
        if (this.currentCase) {
            this.updateActiveCaseHeader();
        }
    }
    
    loadCasesFromLocalStorage() {
        const storageKey = `fsr-cases-${this.userId}`;
        const savedCases = localStorage.getItem(storageKey);
        
        if (savedCases) {
            this.cases = JSON.parse(savedCases);
            
            // Migrate string case numbers to integers if needed
            let needsMigration = false;
            this.cases.forEach(caseData => {
                if (typeof caseData.caseNumber === 'string' && caseData.caseNumber.startsWith('CASE-')) {
                    // Convert "CASE-2024-001" to 2024001
                    const parts = caseData.caseNumber.split('-');
                    if (parts.length === 3) {
                        const year = parts[1];
                        const number = parts[2].padStart(3, '0');
                        caseData.caseNumber = parseInt(year + number);
                        needsMigration = true;
                        console.log(`🔄 [CaseManager] Migrated case number: ${caseData.caseNumber}`);
                    }
                }
            });
            
            if (needsMigration) {
                console.log('💾 [CaseManager] Migrating localStorage case numbers to integer format');
                this.saveCasesLocally();
            }
            
            console.log(`Loaded ${this.cases.length} cases from localStorage`);
        } else {
            this.cases = [];
            console.log(`No cases found in localStorage`);
        }
    }
    
    // Removed: filterClosedCases() - No longer needed, case status is provided by database endpoints
    
    saveCases() {
        // Save to localStorage for quick access
        this.saveCasesLocally();
    }
    
    saveCasesLocally() {
        if (this.userId === null || this.userId === undefined) {
            console.warn('No user ID available, cannot save cases');
            return;
        }
        
        const storageKey = `fsr-cases-${this.userId}`;
        localStorage.setItem(storageKey, JSON.stringify(this.cases));
        console.log(`Saved ${this.cases.length} cases to localStorage for user ${this.userId}`);
    }
    
    async saveCaseToBackend(caseData) {
        if (this.userId === null || this.userId === undefined) {
            console.warn('⚠️ [CaseManager] No user ID available, cannot save to backend');
            return false;
        }
        
        // Skip saving untracked cases to backend
        if (caseData.isTrackedInDatabase === false) {
            console.log(`⏭️ [CaseManager] Skipping backend save for untracked case ${caseData.caseNumber}`);
            return true; // Not an error, just skipped
        }
        
        console.log(`💾 [CaseManager] Saving case ${caseData.caseNumber} to database...`);
        console.log(`📝 [CaseManager] Problem Statement: ${(caseData.problemStatement || '').substring(0, 50)}...`);
        console.log(`📝 [CaseManager] FSR Notes: ${(caseData.fsrNotes || '').substring(0, 50)}...`);
        
        try {
            // Use the new input state endpoint
            const response = await fetch('/api/cases/input-state', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    case_number: caseData.caseNumber,
                    problem_statement: caseData.problemStatement || '',
                    fsr_notes: caseData.fsrNotes || '',
                    evaluation_id: caseData.lastEvaluationId || null
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ [CaseManager] Successfully saved case ${caseData.caseNumber} to database`);
                console.log(`📊 [CaseManager] Database response:`, result);
                return true;
            } else {
                const errorText = await response.text();
                console.error(`❌ [CaseManager] Failed to save case ${caseData.caseNumber} to database:`, {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                return false;
            }
        } catch (error) {
            console.error(`❌ [CaseManager] Error saving case ${caseData.caseNumber} to database:`, error);
            return false;
        }
    }
    
    async saveCaseTitleToDatabase(caseNumber, caseTitle) {
        if (this.userId === null || this.userId === undefined) {
            console.warn('⚠️ [CaseManager] No user ID available, cannot save case title to backend');
            return false;
        }
        
        if (!caseTitle || !caseTitle.trim()) {
            console.warn(`⚠️ [CaseManager] Empty case title, skipping save for case ${caseNumber}`);
            return false;
        }
        
        console.log(`💾 [CaseManager] Saving case title for case ${caseNumber} to database...`);
        console.log(`📝 [CaseManager] Case Title: ${caseTitle.substring(0, 50)}...`);
        
        try {
            const response = await fetch('/api/cases/update-title', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    case_number: caseNumber,
                    case_title: caseTitle.trim()
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ [CaseManager] Successfully saved case title for case ${caseNumber} to database`);
                return true;
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error(`❌ [CaseManager] Failed to save case title for case ${caseNumber} to database:`, errorData);
                return false;
            }
        } catch (error) {
            console.error(`❌ [CaseManager] Error saving case title for case ${caseNumber} to database:`, error);
            return false;
        }
    }
    
    async createNewCase() {
        // Show case number input with suggestions
        const caseNumber = await this.showCaseNumberInputWithSuggestions();
        
        // Check if user cancelled (null means cancelled, empty string means no input)
        if (caseNumber === null) {
            // User cancelled, just return without error
            return;
        }
        
        // Validate input
        if (!caseNumber || caseNumber.trim() === '') {
            await this.showCustomAlert('Error', 'Case number is required.');
            return;
        }
        
        const trimmedCaseNumber = caseNumber.trim();
        
        // Simple validation: check for obviously wrong inputs
        // - Maximum length to prevent extremely long inputs
        // - Allow alphanumeric and common special characters
        const MAX_CASE_NUMBER_LENGTH = 50;
        
        if (trimmedCaseNumber.length > MAX_CASE_NUMBER_LENGTH) {
            await this.showCustomAlert('Invalid Case Number', 
                `Case number is too long. Maximum length is ${MAX_CASE_NUMBER_LENGTH} characters.`);
            return;
        }
        
        if (trimmedCaseNumber.length < 1) {
            await this.showCustomAlert('Invalid Case Number', 'Case number cannot be empty.');
            return;
        }
        
        // Use trimmed case number as-is (can include characters)
        const caseNumberValue = trimmedCaseNumber;
        
        // Check if case number already exists locally
        const existingCase = this.cases.find(c => c.caseNumber === caseNumberValue || String(c.caseNumber) === caseNumberValue);
        if (existingCase) {
            await this.showCustomAlert('Case Already Exists', 'This case number already exists in your list.');
            // Switch to existing case
            this.switchToCase(existingCase.id);
            return;
        }
        
        // Try to create case in database first
        try {
            console.log(`🚀 [CaseManager] Attempting to create case ${caseNumberValue} in database...`);
            
            const createResponse = await fetch('/api/cases/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    case_number: caseNumberValue
                })
            });
            
            let isTrackedInDatabase = true;
            let untrackedCaseTitle = null;
            
            if (createResponse.ok) {
                const createData = await createResponse.json();
                console.log(`✅ [CaseManager] Successfully created case ${caseNumberValue} in database:`, createData);
                
                // Check for CRM warning (case not found in CRM)
                if (createData.warning) {
                    console.log(`⚠️ [CaseManager] CRM warning for case ${caseNumberValue}:`, createData.warning);
                    
                    // Show title prompt for untracked case
                    const caseTitleInput = await this.showUntrackedCasePrompt(caseNumberValue);
                    
                    if (caseTitleInput === null) {
                        // User cancelled - remove the case we just created
                        await fetch(`/api/cases/delete/${caseNumberValue}`, { method: 'DELETE' });
                        return;
                    }
                    
                    // User provided a title (or left it empty)
                    untrackedCaseTitle = caseTitleInput;
                    isTrackedInDatabase = false;
                    
                    // OPTIMISTIC: Add case to sidebar immediately
                    const newCase = {
                        id: caseNumberValue,
                        caseNumber: caseNumberValue,
                        caseTitle: untrackedCaseTitle,
                        problemStatement: '',
                        fsrNotes: '',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        isTrackedInDatabase: false
                    };
                    
                    console.log(`⚡ [CaseManager] Optimistically adding case ${caseNumberValue} to sidebar...`);
                    this.cases.unshift(newCase);
                    this.hideNoCasesPlaceholder();
                    this.renderCasesList();
                    this.switchToCase(newCase.id);
                    
                    // Close mobile sidebar
                    const sidebar = document.querySelector('.cases-sidebar');
                    if (sidebar && window.innerWidth <= 950) {
                        sidebar.classList.remove('open');
                    }
                    
                    console.log(`✅ [CaseManager] Case ${caseNumberValue} added to sidebar and switched to`);
                    
                    // Save the title to the database in background
                    if (untrackedCaseTitle && untrackedCaseTitle.trim()) {
                        console.log(`💾 [CaseManager] Saving user-provided title for case ${caseNumberValue} in background...`);
                        this.saveCaseTitleToDatabase(caseNumberValue, untrackedCaseTitle).catch(err => {
                            console.error(`❌ [CaseManager] Error saving title for untracked case: ${err}`);
                        });
                    }
                    
                    return; // Exit early, case is already created
                }
            } else if (createResponse.status === 409) {
                // Case already exists - this is actually good, means it's tracked
                console.log(`ℹ️ [CaseManager] Case ${caseNumberValue} already exists in database (tracked)`);
            } else {
                // Case creation failed - treat as untracked
                console.log(`⚠️ [CaseManager] Failed to create case ${caseNumberValue} in database:`, createResponse.status);
                
                const caseTitleInput = await this.showUntrackedCasePrompt(caseNumberValue);
                
                if (caseTitleInput === null) {
                    // User cancelled
                    return;
                }
                
                // User provided a title (or left it empty)
                untrackedCaseTitle = caseTitleInput;
                isTrackedInDatabase = false;
                
                // OPTIMISTIC: Add case to sidebar immediately
                const newCase = {
                    id: caseNumberValue,
                    caseNumber: caseNumberValue,
                    caseTitle: untrackedCaseTitle,
                    problemStatement: '',
                    fsrNotes: '',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isTrackedInDatabase: false
                };
                
                console.log(`⚡ [CaseManager] Optimistically adding untracked case ${caseNumberValue} to sidebar...`);
                this.cases.unshift(newCase);
                this.hideNoCasesPlaceholder();
                this.renderCasesList();
                this.switchToCase(newCase.id);
                
                // Close mobile sidebar
                const sidebar = document.querySelector('.cases-sidebar');
                if (sidebar && window.innerWidth <= 950) {
                    sidebar.classList.remove('open');
                }
                
                console.log(`✅ [CaseManager] Untracked case ${caseNumberValue} added to sidebar`);
                return; // Exit early
            }
            
        // Create the case (either tracked or untracked)
        const newCase = {
            id: caseNumberValue, // Use case number as ID for consistency
            caseNumber: caseNumberValue,
            caseTitle: untrackedCaseTitle || null, // Store the title if provided
            problemStatement: '',
            fsrNotes: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isTrackedInDatabase: isTrackedInDatabase
        };
            
            console.log(`📝 [CaseManager] Creating new case:`, {
                caseNumber: newCase.caseNumber,
                isTracked: newCase.isTrackedInDatabase
            });
            
            this.cases.unshift(newCase); // Add to beginning
            this.saveCases();
            this.renderCasesList();
            
            // If this is a tracked CRM case, fetch the title immediately
            if (isTrackedInDatabase !== false && !untrackedCaseTitle) {
                // Fetch title for this case immediately
                fetch('/api/cases/titles', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        case_numbers: [caseNumberValue]
                    })
                }).then(response => {
                    if (response.ok) {
                        return response.json();
                    }
                }).then(data => {
                    if (data && data.titles && data.titles[String(caseNumberValue)]) {
                        const caseIndex = this.cases.findIndex(c => c.caseNumber === caseNumberValue);
                        if (caseIndex !== -1) {
                            this.cases[caseIndex].caseTitle = data.titles[String(caseNumberValue)];
                            this.saveCases();
                            this.renderCasesList();
                            console.log(`✅ [CaseManager] Updated case ${caseNumberValue} with title immediately`);
                        }
                    }
                }).catch(error => {
                    console.error(`❌ [CaseManager] Error fetching title for case ${caseNumberValue}:`, error);
                });
            }
            
            this.switchToCase(newCase.id);
            
            // Close mobile sidebar
            const sidebar = document.querySelector('.cases-sidebar');
            if (sidebar && window.innerWidth <= 950) {
                sidebar.classList.remove('open');
            }
            
            console.log(`✅ [CaseManager] Case ${caseNumberValue} created successfully`);
            
        } catch (error) {
            console.error('❌ [CaseManager] Error creating case:', error);
            await this.showCustomAlert('Error', 'Error creating case. Please try again.');
        }
    }
    
    async switchToCase(caseId) {
        console.log(`🔄 [CaseManager] switchToCase called with caseId: ${caseId}`);
        const caseData = this.cases.find(c => c.id === caseId);
        if (!caseData) {
            console.log(`❌ [CaseManager] Case not found for caseId: ${caseId}`);
            return;
        }
        
        // Hide "no cases" placeholder if it's showing
        this.hideNoCasesPlaceholder();
        
        console.log(`📝 [CaseManager] Switching from case ${this.currentCase?.caseNumber || 'none'} to case ${caseData.caseNumber}`);
        
        // ============================================================
        // STEP 1: SAVE current case complete state before switching
        // ============================================================
        if (this.currentCase) {
            console.log(`💾 [CaseManager] Saving complete state for case ${this.currentCase.caseNumber}`);
            await this.saveCurrentCaseState();
        }
        
        // ============================================================
        // STEP 2: CLEAR all UI and editor state completely
        // ============================================================
        console.log(`🧹 [CaseManager] Clearing all UI and editor state`);
        this.clearAllEditorState();
        
        // ============================================================
        // STEP 3: SET new current case
        // ============================================================
        this.currentCase = caseData;
        console.log(`✅ [CaseManager] Current case set to: ${caseData.caseNumber}`);
        
        // ============================================================
        // STEP 4: RESTORE the new case's saved state (if it exists)
        // ============================================================
        if (caseData.editorStates) {
            console.log(`🔄 [CaseManager] Restoring saved state for case ${caseData.caseNumber}`);
            this.restoreEditorState('editor', caseData.editorStates.editor);
            this.restoreEditorState('editor2', caseData.editorStates.editor2);
            
            // Update score bars after restoring state
            if (window.spellCheckEditor) {
                window.spellCheckEditor.updateEditorLabelsWithScore();
                console.log('✅ [CaseManager] Score bars updated after state restoration');
            }
        } else {
            console.log(`📝 [CaseManager] No saved state, loading fresh data for case ${caseData.caseNumber}`);
            
            // Load text content into editors
            const editor1 = document.getElementById('editor');
            const editor2 = document.getElementById('editor2');
            
            if (editor1) {
                editor1.innerText = caseData.problemStatement || '';
                console.log(`📝 [CaseManager] Loaded problem statement (${editor1.innerText.length} chars)`);
            }
            if (editor2) {
                editor2.innerText = caseData.fsrNotes || '';
                console.log(`📝 [CaseManager] Loaded FSR notes (${editor2.innerText.length} chars)`);
            }
            
            // Only load CRM data for cases tracked in the database
            if (caseData.isTrackedInDatabase !== false) {
                console.log(`🔍 [CaseManager] Case is tracked, loading CRM history`);
                this.showCaseLoadingIndicator('Loading CRM Data...');
                try {
                    await this.loadCRMDataAndPopulateHistory(caseData.caseNumber);
                } finally {
                    this.hideCaseLoadingIndicator();
                }
            } else {
                console.log(`⏭️ [CaseManager] Case is not tracked in database, skipping CRM data loading`);
            }
        }
        
        // ============================================================
        // STEP 5: UPDATE UI
        // ============================================================
        this.renderCasesList();
        this.updateActiveCaseHeader();
        
        // ============================================================
        // STEP 6: RUN SPELL CHECK on restored content
        // ============================================================
        if (window.spellCheckEditor) {
            console.log('🔍 [CaseManager] Running spell check on both editors');
            window.spellCheckEditor.checkText('editor');
            window.spellCheckEditor.checkText('editor2');
        }
        
        console.log(`✅ [CaseManager] Successfully switched to case ${caseData.caseNumber}`);
    }
    
    /**
     * Clear all editor state completely (for clean case switching)
     */
    clearAllEditorState() {
        console.log('🧹 [CaseManager] Clearing all editor state for clean switch');
        
        // Clear evaluation UI elements
        const evalBox = document.getElementById('llm-eval-box');
        const rewritePopup = document.getElementById('rewrite-popup');
        
        if (evalBox) {
            evalBox.style.display = 'none';
            evalBox.innerHTML = '';
        }
        
        if (rewritePopup) {
            rewritePopup.style.display = 'none';
            rewritePopup.innerHTML = '';
        }
        
        // Clear spellCheckEditor internal state for both fields
        if (window.spellCheckEditor) {
            // Clear editor field state
            if (window.spellCheckEditor.fields.editor) {
                const editorField = window.spellCheckEditor.fields.editor;
                editorField.history = [];
                editorField.matches = [];
                editorField.currentSuggestions = [];
                editorField.ignoredSuggestions = new Set();
                editorField.llmLastResult = null;
                editorField.llmQuestions = [];
                editorField.llmAnswers = {};
                editorField.rewriteUuid = null;
                editorField.userInputId = null;
                editorField.reviewId = null;
                editorField.evaluationId = null;
                editorField.calculatedScore = null;
                editorField.rewriteIdByCriteria = {};
                editorField.lastRewriteQA = null;
                editorField.lastRewriteUserInputs = [];
                editorField.rewrittenSnapshot = null;
                editorField.prevVersionBeforeRewrite = null;
                editorField.lastOriginalText = null;
                editorField.llmInProgress = false;
                editorField.isRestoringFromHistory = false;
                editorField.overlayHidden = false;
                editorField.awaitingCheck = false;
                // Clear highlight overlay
                if (editorField.highlightOverlay) {
                    editorField.highlightOverlay.innerHTML = '';
                }
                // Reset button states to remove any animations
                window.spellCheckEditor.resetButtonState('editor');
            }
            
            // Clear editor2 field state
            if (window.spellCheckEditor.fields.editor2) {
                const editor2Field = window.spellCheckEditor.fields.editor2;
                editor2Field.history = [];
                editor2Field.matches = [];
                editor2Field.currentSuggestions = [];
                editor2Field.ignoredSuggestions = new Set();
                editor2Field.llmLastResult = null;
                editor2Field.llmQuestions = [];
                editor2Field.llmAnswers = {};
                editor2Field.rewriteUuid = null;
                editor2Field.userInputId = null;
                editor2Field.reviewId = null;
                editor2Field.evaluationId = null;
                editor2Field.calculatedScore = null;
                editor2Field.rewriteIdByCriteria = {};
                editor2Field.lastRewriteQA = null;
                editor2Field.lastRewriteUserInputs = [];
                editor2Field.rewrittenSnapshot = null;
                editor2Field.prevVersionBeforeRewrite = null;
                editor2Field.lastOriginalText = null;
                editor2Field.llmInProgress = false;
                editor2Field.isRestoringFromHistory = false;
                editor2Field.overlayHidden = false;
                editor2Field.awaitingCheck = false;
                // Clear highlight overlay
                if (editor2Field.highlightOverlay) {
                    editor2Field.highlightOverlay.innerHTML = '';
                }
                // Reset button states to remove any animations
                window.spellCheckEditor.resetButtonState('editor2');
            }
            
            // Clear rewrite feedback pills
            const pill1 = document.getElementById('rewrite-feedback-pill');
            const pill2 = document.getElementById('rewrite-feedback-pill-2');
            if (pill1) pill1.style.display = 'none';
            if (pill2) pill2.style.display = 'none';
            
            // Clear score bars explicitly
            const score1 = document.getElementById('score-editor');
            const score2 = document.getElementById('score-editor2');
            if (score1) {
                score1.innerHTML = '';
                score1.className = 'editor-score';
            }
            if (score2) {
                score2.innerHTML = '';
                score2.className = 'editor-score';
            }
            
            // Clear CRM history
            this.clearCRMHistory();
            
            // Re-render history to show empty state
            window.spellCheckEditor.renderHistory();
            
            // Update score labels to ensure they're cleared
            window.spellCheckEditor.updateEditorLabelsWithScore();
        }
        
        console.log('✅ [CaseManager] All editor state cleared');
    }
    
    clearCRMHistory() {
        console.log(`🧹 [CaseManager] Clearing all CRM history`);
        
        // Access the global spellCheckEditor instance
        if (!window.spellCheckEditor) {
            console.error(`❌ [CaseManager] spellCheckEditor not available`);
            return;
        }
        
        // Clear ALL existing CRM history
        window.spellCheckEditor.fields.editor.history = window.spellCheckEditor.fields.editor.history.filter(item => 
            typeof item === 'string' || !item.crmSource
        );
        window.spellCheckEditor.fields.editor2.history = window.spellCheckEditor.fields.editor2.history.filter(item => 
            typeof item === 'string' || !item.crmSource
        );
        
        console.log(`✅ [CaseManager] Cleared CRM history for both fields`);
        
        // Update the history display
        window.spellCheckEditor.renderHistory();
    }
    
    async loadCRMDataAndPopulateHistory(caseNumber) {
        console.log(`🔍 [CaseManager] Loading CRM data for case ${caseNumber}`);
        
        try {
            // Fetch CRM details for this case
            const response = await fetch(`/api/cases/details/${caseNumber}`);
            
            if (!response.ok) {
                console.log(`⚠️ [CaseManager] No CRM data available for case ${caseNumber}: ${response.status}`);
                return;
            }
            
            const crmData = await response.json();
            console.log(`📊 [CaseManager] CRM data for case ${caseNumber}:`, crmData);
            
            if (crmData.success && crmData.details && crmData.details.length > 0) {
                console.log(`✅ [CaseManager] Found ${crmData.details.length} FSR records in CRM`);
                
                // Sort FSR records by FSR Number (descending) to get latest first
                const sortedFSR = crmData.details.sort((a, b) => {
                    const fsrA = parseInt(a["FSR Number"]) || 0;
                    const fsrB = parseInt(b["FSR Number"]) || 0;
                    return fsrB - fsrA; // Descending order (latest first)
                });
                
                console.log(`📊 [CaseManager] Sorted FSR records:`, sortedFSR.map(fsr => ({
                    fsrNumber: fsr["FSR Number"],
                    creationDate: fsr["FSR Creation Date"],
                    problemStatement: fsr["FSR Current Problem Statement"]?.substring(0, 50) + '...',
                    dailyNotes: fsr["FSR Daily Notes"]?.substring(0, 50) + '...'
                })));
                
                // Get the most recent data
                const latestFSR = sortedFSR[0];
                const latestProblemStatement = latestFSR["FSR Current Problem Statement"];
                const latestDailyNotes = latestFSR["FSR Daily Notes"];
                const latestSymptom = latestFSR["FSR Current Symptom"];
                const caseTitle = latestFSR["Case Title"]; // Use actual Case Title field
                
                console.log(`📝 [CaseManager] Latest FSR ${latestFSR["FSR Number"]}:`);
                console.log(`📝 [CaseManager] - Case Title: ${caseTitle?.substring(0, 100)}...`);
                console.log(`📝 [CaseManager] - Problem Statement: ${latestProblemStatement?.substring(0, 100)}...`);
                console.log(`📝 [CaseManager] - Daily Notes: ${latestDailyNotes?.substring(0, 100)}...`);
                console.log(`📝 [CaseManager] - Symptom: ${latestSymptom?.substring(0, 100)}...`);
                
                // Store the case title for display in sidebar (use Case Title field, not symptom)
                if (caseTitle && caseTitle.trim()) {
                    // Find the case in our cases array and update it with the case title
                    const caseIndex = this.cases.findIndex(c => c.caseNumber == caseNumber);
                    if (caseIndex !== -1) {
                        const trimmedTitle = caseTitle.trim();
                        this.cases[caseIndex].caseTitle = trimmedTitle;
                        console.log(`📝 [CaseManager] Updated case ${caseNumber} with title: ${trimmedTitle}`);
                        
                        // Save case title to database if case is tracked in database
                        if (this.cases[caseIndex].isTrackedInDatabase) {
                            this.saveCaseTitleToDatabase(caseNumber, trimmedTitle).catch(err => {
                                console.error(`❌ [CaseManager] Error saving case title to database: ${err}`);
                            });
                        }
                    }
                }
                
                // Update current fields with latest CRM data if they're empty or different
                const editor1 = document.getElementById('editor');
                const editor2 = document.getElementById('editor2');
                
                if (editor1 && latestProblemStatement && latestProblemStatement.trim()) {
                    const currentProblem = editor1.innerText.trim();
                    if (!currentProblem || currentProblem !== latestProblemStatement.trim()) {
                        console.log(`📝 [CaseManager] Updating problem statement with CRM data`);
                        editor1.innerText = latestProblemStatement;
                    }
                }
                
                if (editor2 && latestDailyNotes && latestDailyNotes.trim()) {
                    const currentFSR = editor2.innerText.trim();
                    if (!currentFSR || currentFSR !== latestDailyNotes.trim()) {
                        console.log(`📝 [CaseManager] Updating FSR notes with CRM data`);
                        editor2.innerText = latestDailyNotes;
                    }
                }
                
                // Populate history with all FSR records
                this.populateHistoryWithCRMData(sortedFSR);
                
            } else {
                console.log(`ℹ️ [CaseManager] No CRM details found for case ${caseNumber}`);
            }
            
        } catch (error) {
            console.error(`❌ [CaseManager] Error loading CRM data for case ${caseNumber}:`, error);
        }
    }
    
    populateHistoryWithCRMData(fsrRecords) {
        console.log(`📚 [CaseManager] Populating history with ${fsrRecords.length} FSR records`);
        
        // Access the global spellCheckEditor instance
        if (!window.spellCheckEditor) {
            console.error(`❌ [CaseManager] spellCheckEditor not available`);
            return;
        }
        
        // CRM history is already cleared in switchToCase() before this function is called
        
        // Group FSR records by unique text content for problem statements and daily notes
        const problemStatementGroups = new Map(); // text -> [fsrNumbers]
        const dailyNotesGroups = new Map(); // text -> [fsrNumbers]
        
        fsrRecords.forEach((fsr) => {
            const problemStatement = fsr["FSR Current Problem Statement"];
            const dailyNotes = fsr["FSR Daily Notes"];
            const fsrNumber = fsr["FSR Number"];
            const creationDate = fsr["FSR Creation Date"];
            
            // Group problem statements
            if (problemStatement && problemStatement.trim()) {
                const text = problemStatement.trim();
                if (!problemStatementGroups.has(text)) {
                    problemStatementGroups.set(text, {
                        fsrNumbers: [],
                        dates: [],
                        text: text
                    });
                }
                problemStatementGroups.get(text).fsrNumbers.push(fsrNumber);
                problemStatementGroups.get(text).dates.push(creationDate);
            }
            
            // Group daily notes
            if (dailyNotes && dailyNotes.trim()) {
                const text = dailyNotes.trim();
                if (!dailyNotesGroups.has(text)) {
                    dailyNotesGroups.set(text, {
                        fsrNumbers: [],
                        dates: [],
                        text: text
                    });
                }
                dailyNotesGroups.get(text).fsrNumbers.push(fsrNumber);
                dailyNotesGroups.get(text).dates.push(creationDate);
            }
        });
        
        console.log(`📊 [CaseManager] Grouped duplicates:`, {
            uniqueProblemStatements: problemStatementGroups.size,
            totalProblemStatements: fsrRecords.filter(f => f["FSR Current Problem Statement"]).length,
            uniqueDailyNotes: dailyNotesGroups.size,
            totalDailyNotes: fsrRecords.filter(f => f["FSR Daily Notes"]).length
        });
        
        // Add grouped problem statements to history
        problemStatementGroups.forEach((group) => {
            const problemHistoryEntry = {
                text: group.text,
                llmLastResult: null,
                userInputId: null,
                rewriteUuid: null,
                reviewId: null,
                timestamp: new Date(group.dates[0]).toISOString(), // Use first date
                crmSource: true,
                fsrNumbers: group.fsrNumbers, // Array of all FSR numbers with this text
                creationDate: group.dates[0] // Use first date for display
            };
            window.spellCheckEditor.fields.editor.history.push(problemHistoryEntry);
        });
        
        // Add grouped daily notes to history
        dailyNotesGroups.forEach((group) => {
            const dailyNotesHistoryEntry = {
                text: group.text,
                llmLastResult: null,
                userInputId: null,
                rewriteUuid: null,
                reviewId: null,
                timestamp: new Date(group.dates[0]).toISOString(), // Use first date
                crmSource: true,
                fsrNumbers: group.fsrNumbers, // Array of all FSR numbers with this text
                creationDate: group.dates[0] // Use first date for display
            };
            window.spellCheckEditor.fields.editor2.history.push(dailyNotesHistoryEntry);
        });
        
        console.log(`✅ [CaseManager] History populated with grouped entries:`, {
            problemStatement_history_count: window.spellCheckEditor.fields.editor.history.length,
            fsrNotes_history_count: window.spellCheckEditor.fields.editor2.history.length
        });
        
        // Update the history display
        window.spellCheckEditor.renderHistory();
    }
    
    /**
     * Capture complete state snapshot from an editor field
     */
    captureEditorState(fieldName) {
        if (!window.spellCheckEditor || !window.spellCheckEditor.fields[fieldName]) {
            console.warn(`⚠️ [CaseManager] Cannot capture state: field ${fieldName} not found`);
            return null;
        }
        
        const field = window.spellCheckEditor.fields[fieldName];
        const editor = document.getElementById(fieldName);
        
        const state = {
            // Text content
            text: editor ? editor.innerText : '',
            
            // Evaluation results
            llmLastResult: field.llmLastResult,
            llmQuestions: field.llmQuestions || [],
            llmAnswers: field.llmAnswers || {},
            calculatedScore: field.calculatedScore,
            
            // Database IDs
            userInputId: field.userInputId,
            reviewId: field.reviewId,
            rewriteUuid: field.rewriteUuid,
            evaluationId: field.evaluationId,
            
            // History entries
            history: field.history || [],
            
            // Rewrite state
            rewriteIdByCriteria: field.rewriteIdByCriteria || {},
            lastRewriteQA: field.lastRewriteQA,
            lastRewriteUserInputs: field.lastRewriteUserInputs || [],
            rewrittenSnapshot: field.rewrittenSnapshot,
            prevVersionBeforeRewrite: field.prevVersionBeforeRewrite,
            lastOriginalText: field.lastOriginalText,
            
            // UI state
            isCollapsed: window.spellCheckEditor.evalCollapsed ? window.spellCheckEditor.evalCollapsed[fieldName] : true,
            llmInProgress: field.llmInProgress || false, // Save if LLM is in progress
            
            // Line item tracking
            lineItemId: field.lineItemId,
            problemVersionId: field.problemVersionId
        };
        
        console.log(`📸 [CaseManager] Captured state for ${fieldName}:`, {
            text_length: state.text.length,
            has_llmResult: !!state.llmLastResult,
            history_count: state.history.length,
            calculatedScore: state.calculatedScore,
            userInputId: state.userInputId,
            llmInProgress: state.llmInProgress
        });
        
        return state;
    }
    
    /**
     * Restore complete state snapshot to an editor field
     */
    restoreEditorState(fieldName, state) {
        if (!window.spellCheckEditor || !window.spellCheckEditor.fields[fieldName]) {
            console.warn(`⚠️ [CaseManager] Cannot restore state: field ${fieldName} not found`);
            return;
        }
        
        if (!state) {
            console.log(`ℹ️ [CaseManager] No saved state for ${fieldName}, keeping clean slate`);
            return;
        }
        
        const field = window.spellCheckEditor.fields[fieldName];
        const editor = document.getElementById(fieldName);
        
        console.log(`🔄 [CaseManager] Restoring state for ${fieldName}:`, {
            text_length: state.text ? state.text.length : 0,
            has_llmResult: !!state.llmLastResult,
            history_count: state.history ? state.history.length : 0,
            calculatedScore: state.calculatedScore,
            llmInProgress: state.llmInProgress
        });
        
        // Restore text content
        if (editor && state.text !== undefined) {
            editor.innerText = state.text;
        }
        
        // Restore evaluation results
        field.llmLastResult = state.llmLastResult || null;
        field.llmQuestions = state.llmQuestions || [];
        field.llmAnswers = state.llmAnswers || {};
        field.calculatedScore = state.calculatedScore || null;
        
        // Restore database IDs
        field.userInputId = state.userInputId || null;
        field.reviewId = state.reviewId || null;
        field.rewriteUuid = state.rewriteUuid || null;
        field.evaluationId = state.evaluationId || null;
        
        // Restore history
        field.history = state.history || [];
        
        // Restore rewrite state
        field.rewriteIdByCriteria = state.rewriteIdByCriteria || {};
        field.lastRewriteQA = state.lastRewriteQA || null;
        field.lastRewriteUserInputs = state.lastRewriteUserInputs || [];
        field.rewrittenSnapshot = state.rewrittenSnapshot || null;
        field.prevVersionBeforeRewrite = state.prevVersionBeforeRewrite || null;
        field.lastOriginalText = state.lastOriginalText || null;
        
        // Restore UI state
        if (window.spellCheckEditor.evalCollapsed && state.isCollapsed !== undefined) {
            window.spellCheckEditor.evalCollapsed[fieldName] = state.isCollapsed;
        }
        
        // Restore line item tracking
        field.lineItemId = state.lineItemId || 1;
        field.problemVersionId = state.problemVersionId || 1;
        
        // Restore LLM in-progress state and button animation
        field.llmInProgress = state.llmInProgress || false;
        if (state.llmInProgress) {
            console.log(`🔄 [CaseManager] LLM is still in progress for ${fieldName}, restoring button animation`);
            // Determine if this is a review or rewrite based on whether we have questions
            const isRewrite = state.lastRewriteQA && Object.keys(state.lastRewriteQA).length > 0;
            window.spellCheckEditor.updateButtonState(fieldName, isRewrite ? 'rewriting' : 'reviewing');
        }
        
        // Re-render evaluation if we have results
        if (state.llmLastResult) {
            const hasRewrite = state.llmLastResult.rewrite || state.llmLastResult.rewritten_problem_statement;
            window.spellCheckEditor.displayLLMResult(state.llmLastResult, hasRewrite, fieldName, false);
            
            // Show rewrite pill if we have a rewritten snapshot
            if (state.rewrittenSnapshot) {
                const pillId = fieldName === 'editor' ? 'rewrite-feedback-pill' : 'rewrite-feedback-pill-2';
                const pill = document.getElementById(pillId);
                if (pill) pill.style.display = 'block';
            }
        }
        
        // Re-render history
        window.spellCheckEditor.renderHistory();
        
        console.log(`✅ [CaseManager] State restored for ${fieldName}`);
    }
    
    /**
     * Save complete case state including all editor states
     */
    async saveCurrentCaseState() {
        if (!this.currentCase) {
            console.log('ℹ️ [CaseManager] No current case to save');
            return;
        }
        
        console.log(`💾 [CaseManager] Saving complete state for case ${this.currentCase.caseNumber}`);
        
        // Capture text content
        const editor1 = document.getElementById('editor');
        const editor2 = document.getElementById('editor2');
        
        if (editor1) this.currentCase.problemStatement = editor1.innerText;
        if (editor2) this.currentCase.fsrNotes = editor2.innerText;
        
        // Capture complete editor states
        if (!this.currentCase.editorStates) {
            this.currentCase.editorStates = {};
        }
        
        this.currentCase.editorStates.editor = this.captureEditorState('editor');
        this.currentCase.editorStates.editor2 = this.captureEditorState('editor2');
        
        this.currentCase.updatedAt = new Date();
        
        console.log(`✅ [CaseManager] Captured state:`, {
            caseNumber: this.currentCase.caseNumber,
            problemStatement_length: this.currentCase.problemStatement.length,
            fsrNotes_length: this.currentCase.fsrNotes.length,
            editor_state: !!this.currentCase.editorStates.editor,
            editor2_state: !!this.currentCase.editorStates.editor2
        });
        
        // Save to localStorage immediately
        this.saveCases();
        
        // Also save to backend (async, don't wait) - only text content
        this.saveCaseToBackend(this.currentCase);
    }
    
    
    renderCasesList() {
        
        const casesList = document.getElementById('cases-list');
        if (!casesList) {
            console.error('❌ [CaseManager] cases-list element not found');
            return;
        }
        
        casesList.innerHTML = '';
        
        // Sort cases by case number descending (highest first)
        const sortedCases = [...this.cases].sort((a, b) => b.caseNumber - a.caseNumber);
        
        sortedCases.forEach(caseData => {
            const caseItem = document.createElement('div');
            caseItem.className = `case-item ${this.currentCase && this.currentCase.id === caseData.id ? 'active' : ''}`;
            
            // Add visual indicator for untracked cases
            const untrackedIndicator = caseData.isTrackedInDatabase === false ? 
                '<div class="untracked-indicator" title="Not tracked in database">⚠️</div>' : '';
            
            // Use case title if available, otherwise fall back to case number
            const displayTitle = caseData.caseTitle || `Case ${caseData.caseNumber}`;
            
            caseItem.innerHTML = `
                <div>
                    <div class="case-number" title="${caseData.caseNumber}">${displayTitle}</div>
                    <div class="case-date">Case ${caseData.caseNumber}</div>
                </div>
                <div class="case-actions">
                    ${untrackedIndicator}
                    <button class="delete-case-btn" title="Delete case" data-case-id="${caseData.id}">×</button>
                </div>
            `;
            
            // Add click handler for case item (but not for delete button)
            caseItem.addEventListener('click', (e) => {
                // Don't switch case if delete button was clicked
                if (e.target.classList.contains('delete-case-btn')) {
                    return;
                }
                this.switchToCase(caseData.id);
            });
            
            // Add click handler for delete button
            const deleteBtn = caseItem.querySelector('.delete-case-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent case item click
                this.deleteCase(caseData.id);
            });
            
            casesList.appendChild(caseItem);
        });
    }
    
    updateActiveCaseHeader() {
        if (!this.currentCase) return;
        
        // Use case title (symptom) if available, otherwise fall back to case number
        const displayTitle = this.currentCase.caseTitle || this.currentCase.caseNumber;
        
        // Update the active case box display
        const caseNumberDisplay = document.getElementById('case-number-display');
        if (caseNumberDisplay) {
            caseNumberDisplay.textContent = displayTitle;
            caseNumberDisplay.title = this.currentCase.caseNumber; // Show case number in tooltip
        }
        
        // Update any case-specific UI elements
        const activeHeader = document.getElementById('active-editor-header');
        if (activeHeader) {
            activeHeader.innerHTML = `<div style="color: #41007F; font-weight: 600; margin-bottom: 8px;">Active Case: ${displayTitle}</div>`;
        }
    }
    
    async deleteCase(caseId) {
        try {
            // Find the case to delete
            const caseToDelete = this.cases.find(c => c.id === caseId);
            if (!caseToDelete) {
                console.error('Case not found:', caseId);
                return;
            }
            
            // Show styled confirmation popup
            const confirmed = await this.showDeleteConfirmation(caseToDelete);
            
            if (!confirmed) {
                return;
            }
            
            console.log('🗑️ [CaseManager] Deleting case:', caseToDelete.caseNumber);
            
            // If it's the current case, handle case switching
            if (this.currentCase && this.currentCase.id === caseId) {
                const otherCases = this.cases.filter(c => c.id !== caseId);
                if (otherCases.length > 0) {
                    // Switch to another case before deleting
                    await this.switchToCase(otherCases[0].id);
                } else {
                    // No other cases will remain, clear everything
                    console.log('🧹 [CaseManager] Last case being deleted, clearing all UI');
                    this.currentCase = null;
                }
            }
            
            // Remove from local array
            this.cases = this.cases.filter(c => c.id !== caseId);
            
            // Save to localStorage
            this.saveCasesLocally();
            
            // If case is tracked in database, delete from backend
            if (caseToDelete.isTrackedInDatabase) {
                try {
                    // Convert to string to avoid scientific notation for large numbers
                    const caseNumberStr = String(caseToDelete.caseNumber);
                    console.log(`🔍 [CaseManager] Deleting from backend with case number: ${caseNumberStr}`);
                    
                    const response = await fetch(`/api/cases/delete/${caseNumberStr}`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (response.ok) {
                        console.log('✅ [CaseManager] Case deleted from database');
                    } else {
                        console.error('❌ [CaseManager] Failed to delete case from database');
                    }
                } catch (error) {
                    console.error('❌ [CaseManager] Error deleting case from database:', error);
                }
            }
            
            // Re-render the cases list
            this.renderCasesList();
            this.updateActiveCaseHeader();
            
            // If no cases left, clear all editors and UI
            if (this.cases.length === 0) {
                console.log('🧹 [CaseManager] No cases left, clearing all editors and UI');
                this.clearAllEditorsAndUI();
            }
            
            console.log('✅ [CaseManager] Case deleted successfully');
            
        } catch (error) {
            console.error('❌ [CaseManager] Error deleting case:', error);
        }
    }
    
    clearAllEditorsAndUI() {
        console.log('🧹 [CaseManager] Clearing all editors and UI elements');
        
        // Clear editor content
        const editor1 = document.getElementById('editor');
        const editor2 = document.getElementById('editor2');
        
        if (editor1) {
            editor1.innerText = '';
            console.log('✅ [CaseManager] Cleared editor1');
        }
        if (editor2) {
            editor2.innerText = '';
            console.log('✅ [CaseManager] Cleared editor2');
        }
        
        // Clear CRM history
        this.clearCRMHistory();
        
        // Clear evaluation results
        const evalBox = document.getElementById('llm-eval-box');
        const rewritePopup = document.getElementById('rewrite-popup');
        
        if (evalBox) {
            evalBox.style.display = 'none';
            evalBox.innerHTML = '';
            console.log('✅ [CaseManager] Cleared evaluation box');
        }
        
        if (rewritePopup) {
            rewritePopup.style.display = 'none';
            rewritePopup.innerHTML = '';
            console.log('✅ [CaseManager] Cleared rewrite popup');
        }
        
        // Clear any lingering UI elements
        if (window.spellCheckEditor) {
            // Clear fields data
            if (window.spellCheckEditor.fields.editor) {
                window.spellCheckEditor.fields.editor.history = [];
                window.spellCheckEditor.fields.editor.matches = [];
            }
            if (window.spellCheckEditor.fields.editor2) {
                window.spellCheckEditor.fields.editor2.history = [];
                window.spellCheckEditor.fields.editor2.matches = [];
            }
            
            // Re-render history to show empty state
            window.spellCheckEditor.renderHistory();
            
            console.log('✅ [CaseManager] Cleared spellCheckEditor fields');
        }
        
        // Show "no cases" placeholder
        this.showNoCasesPlaceholder();
        
        console.log('✅ [CaseManager] All editors and UI cleared');
    }
    
    showNoCasesPlaceholder() {
        console.log('📄 [CaseManager] Showing no cases placeholder');
        
        // Hide the main content areas
        const leftColumn = document.querySelector('.left-column');
        const rightColumn = document.querySelector('.right-column');
        
        if (leftColumn) leftColumn.style.display = 'none';
        if (rightColumn) rightColumn.style.display = 'none';
        
        // Create placeholder overlay
        const contentFlex = document.querySelector('.content-flex-columns');
        if (!contentFlex) return;
        
        // Remove any existing placeholder
        const existingPlaceholder = document.getElementById('no-cases-placeholder');
        if (existingPlaceholder) existingPlaceholder.remove();
        
        // Create new placeholder
        const placeholder = document.createElement('div');
        placeholder.id = 'no-cases-placeholder';
        placeholder.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 500px;
            padding: 40px;
            text-align: center;
            width: 100%;
        `;
        
        placeholder.innerHTML = `
            <div style="font-size: 64px; margin-bottom: 24px; opacity: 0.3;">📁</div>
            <h2 style="color: #374151; font-size: 24px; font-weight: 600; margin-bottom: 12px;">
                No Cases Open
            </h2>
            <p style="color: #6b7280; font-size: 16px; margin-bottom: 32px; max-width: 400px;">
                Open or create a case to get started with FSR Coach
            </p>
            <button id="open-case-from-placeholder" style="
                padding: 14px 28px;
                background: linear-gradient(135deg, #41007F 0%, #5a1a9a 100%);
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 600;
                font-size: 15px;
                transition: all 0.2s ease;
                box-shadow: 0 4px 6px rgba(65, 0, 127, 0.2);
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(65, 0, 127, 0.3)'" 
               onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(65, 0, 127, 0.2)'">
                📂 Open a Case
            </button>
        `;
        
        contentFlex.appendChild(placeholder);
        
        // Add click handler to open case
        const openButton = document.getElementById('open-case-from-placeholder');
        if (openButton) {
            openButton.addEventListener('click', () => {
                console.log('🔘 [CaseManager] Open case button clicked from placeholder');
                this.createNewCase();
            });
        }
        
        console.log('✅ [CaseManager] No cases placeholder displayed');
    }
    
    hideNoCasesPlaceholder() {
        console.log('🔄 [CaseManager] Hiding no cases placeholder');
        
        // Show the main content areas
        const leftColumn = document.querySelector('.left-column');
        const rightColumn = document.querySelector('.right-column');
        
        if (leftColumn) leftColumn.style.display = '';
        if (rightColumn) rightColumn.style.display = '';
        
        // Remove placeholder
        const placeholder = document.getElementById('no-cases-placeholder');
        if (placeholder) placeholder.remove();
        
        console.log('✅ [CaseManager] No cases placeholder hidden');
    }
    
    formatDate(date) {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
    
    async showCaseNumberInputWithSuggestions() {
        return new Promise((resolve) => {
            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            `;
            
            // Create modal content
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: white;
                padding: 0;
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
                max-width: 600px;
                width: 90%;
                max-height: 80vh;
                overflow: hidden;
                border: 1px solid #e1e5e9;
            `;
            
            modal.innerHTML = `
                <div style="background: linear-gradient(135deg, #41007F 0%, #5a1a9a 100%); padding: 24px; color: white; position: relative;">
                    <button id="close-case-btn" style="position: absolute; top: 16px; right: 16px; background: none; border: none; 
                            color: white; font-size: 24px; cursor: pointer; padding: 4px; border-radius: 4px; 
                            transition: background 0.2s ease;" title="Close">×</button>
                    <h3 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600;">Create New Case</h3>
                    <p style="margin: 0; opacity: 0.9; font-size: 14px;">Enter a case number to get started</p>
                </div>
                <div style="padding: 32px;">
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #374151; font-size: 14px;">Case Number</label>
                        <input type="text" id="case-number-input" placeholder="Start typing case number..." 
                               style="width: 100%; padding: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; 
                                      transition: border-color 0.2s ease; box-sizing: border-box;
                                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                        <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 13px;">Type to search for available case numbers from CRM</p>
                    </div>
                    <div id="case-suggestions" style="max-height: 200px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 24px; display: none; background: #f9fafb;">
                        <!-- Suggestions will be populated here -->
                    </div>
                    <div style="display: flex; gap: 12px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                        <button id="cancel-case-btn" style="padding: 12px 24px; border: 1px solid #d1d5db; background: #f9fafb; 
                                color: #374151; border-radius: 8px; cursor: pointer; font-weight: 500; 
                                transition: all 0.2s ease; font-size: 14px;">Cancel</button>
                        <button id="confirm-case-btn" style="padding: 12px 24px; background: linear-gradient(135deg, #41007F 0%, #5a1a9a 100%); 
                                color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; 
                                transition: all 0.2s ease; font-size: 14px;">Create Case</button>
                    </div>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            const input = modal.querySelector('#case-number-input');
            const suggestions = modal.querySelector('#case-suggestions');
            const cancelBtn = modal.querySelector('#cancel-case-btn');
            const confirmBtn = modal.querySelector('#confirm-case-btn');
            
            let suggestionsData = [];
            let selectedIndex = -1;
            let currentFilteringQuery = null;
            
            // Function to filter preloaded suggestions and fetch titles
            const filterSuggestions = async (query) => {
                if (!query || query.length < 1) {
                    suggestionsData = [];
                    displaySuggestions();
                    return;
                }
                
                // Filter preloaded suggestions (already filtered by email) - no database queries
                const filteredCases = this.preloadedSuggestions.filter(caseNum => {
                    return caseNum.toString().toLowerCase().startsWith(query.toLowerCase());
                }).slice(0, 10); // Limit to 10 suggestions
                
                console.log(`🔍 [CaseManager] Query: "${query}" -> ${filteredCases.length} cases from preloaded suggestions (no DB queries)`);
                
                // Build initial suggestions data (without titles)
                suggestionsData = filteredCases.map(caseNum => ({
                    caseNumber: caseNum,
                    caseName: null // Will be fetched next
                }));
                
                // Display suggestions immediately (with "Available in CRM" placeholder)
                displaySuggestions();
                
                // Fetch titles for filtered cases in background
                if (filteredCases.length > 0) {
                    try {
                        const response = await fetch('/api/cases/titles', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                case_numbers: filteredCases
                            })
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            const titles = data.titles || {};
                            
                            // Update suggestions with titles
                            suggestionsData = filteredCases.map(caseNum => ({
                                caseNumber: caseNum,
                                caseName: titles[String(caseNum)] || null
                            }));
                            
                            console.log(`✅ [CaseManager] Fetched titles for ${filteredCases.length} cases`);
                            displaySuggestions(); // Re-render with titles
                        } else {
                            console.log(`⚠️ [CaseManager] Failed to fetch titles: ${response.status}`);
                        }
                    } catch (error) {
                        console.error(`❌ [CaseManager] Error fetching titles:`, error);
                        // Continue with suggestions without titles
                    }
                }
            };
            
            // Function to display suggestions
            const displaySuggestions = () => {
                if (suggestionsData.length === 0) {
                    suggestions.style.display = 'none';
                    return;
                }
                
                suggestions.innerHTML = suggestionsData.map((suggestion, index) => {
                    const caseNum = suggestion.caseNumber;
                    const caseName = suggestion.caseName;
                    
                    return `
                        <div class="suggestion-item" data-index="${index}" 
                             style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #e5e7eb; 
                                    transition: all 0.2s ease; font-size: 14px; color: #374151;
                                    ${index === selectedIndex ? 'background: #dbeafe; color: #1e40af; font-weight: 500;' : ''}
                                    &:hover { background: #f3f4f6; }">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; flex-shrink: 0;"></div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 500; color: #111827;">Case ${caseNum}</div>
                                    ${caseName ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${caseName}</div>` : 
                                      `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Available in CRM</div>`}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
                
                suggestions.style.display = 'block';
                
                // Add click handlers and hover effects for suggestions
                suggestions.querySelectorAll('.suggestion-item').forEach((item, index) => {
                    item.addEventListener('click', () => {
                        input.value = suggestionsData[index].caseNumber;
                        suggestions.style.display = 'none';
                        selectedIndex = -1;
                    });
                    
                    item.addEventListener('mouseenter', () => {
                        if (index !== selectedIndex) {
                            item.style.background = '#f3f4f6';
                        }
                    });
                    
                    item.addEventListener('mouseleave', () => {
                        if (index !== selectedIndex) {
                            item.style.background = '';
                        }
                    });
                });
            };
            
            // Input event handler - triggers immediately on each keystroke
            input.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                // Trigger filtering immediately - ongoing operations will be cancelled
                filterSuggestions(query);
            });
            
            // Add focus and blur effects
            input.addEventListener('focus', (e) => {
                e.target.style.borderColor = '#41007F';
                e.target.style.boxShadow = '0 0 0 3px rgba(65, 0, 127, 0.1)';
            });
            
            input.addEventListener('blur', (e) => {
                e.target.style.borderColor = '#e5e7eb';
                e.target.style.boxShadow = 'none';
            });
            
            // Add hover effects to buttons
            const cancelBtnHover = modal.querySelector('#cancel-case-btn');
            const confirmBtnHover = modal.querySelector('#confirm-case-btn');
            
            cancelBtnHover.addEventListener('mouseenter', () => {
                cancelBtnHover.style.background = '#f3f4f6';
                cancelBtnHover.style.borderColor = '#9ca3af';
            });
            
            cancelBtnHover.addEventListener('mouseleave', () => {
                cancelBtnHover.style.background = '#f9fafb';
                cancelBtnHover.style.borderColor = '#d1d5db';
            });
            
            confirmBtnHover.addEventListener('mouseenter', () => {
                confirmBtnHover.style.transform = 'translateY(-1px)';
                confirmBtnHover.style.boxShadow = '0 4px 12px rgba(65, 0, 127, 0.3)';
            });
            
            confirmBtnHover.addEventListener('mouseleave', () => {
                confirmBtnHover.style.transform = 'translateY(0)';
                confirmBtnHover.style.boxShadow = 'none';
            });
            
            // Keyboard navigation
            input.addEventListener('keydown', (e) => {
                if (suggestions.style.display === 'none') return;
                
                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        selectedIndex = Math.min(selectedIndex + 1, suggestionsData.length - 1);
                        displaySuggestions();
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        selectedIndex = Math.max(selectedIndex - 1, -1);
                        displaySuggestions();
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (selectedIndex >= 0 && selectedIndex < suggestionsData.length) {
                            input.value = suggestionsData[selectedIndex].caseNumber;
                            suggestions.style.display = 'none';
                            selectedIndex = -1;
                        }
                        break;
                    case 'Escape':
                        suggestions.style.display = 'none';
                        selectedIndex = -1;
                        break;
                }
            });
            
            // Button handlers
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            
            // Close button (X) handler - just close without error
            const closeBtn = modal.querySelector('#close-case-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(null);
                });
                
                // Add hover effects for close button
                closeBtn.addEventListener('mouseenter', () => {
                    closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
                });
                
                closeBtn.addEventListener('mouseleave', () => {
                    closeBtn.style.background = 'none';
                });
            }
            
            confirmBtn.addEventListener('click', () => {
                const value = input.value.trim();
                document.body.removeChild(overlay);
                resolve(value);
            });
            
            // Focus input
            input.focus();
        });
    }
    
    // Custom popup functions
    showCustomAlert(title, message) {
        return new Promise((resolve) => {
            const popup = document.getElementById('custom-popup');
            const popupTitle = document.getElementById('popup-title');
            const popupMessage = document.getElementById('popup-message');
            const popupCancel = document.getElementById('popup-cancel');
            const popupConfirm = document.getElementById('popup-confirm');
            const popupClose = document.getElementById('popup-close');
            
            popupTitle.textContent = title;
            popupMessage.textContent = message;
            
            // Hide cancel button for alert
            popupCancel.style.display = 'none';
            popupConfirm.textContent = 'OK';
            
            popup.style.display = 'flex';
            
            const cleanup = () => {
                popup.style.display = 'none';
                popupCancel.style.display = 'inline-block';
                popupConfirm.textContent = 'Confirm';
                popupConfirm.removeEventListener('click', handleConfirm);
                popupClose.removeEventListener('click', handleClose);
                popupCancel.removeEventListener('click', handleCancel);
            };
            
            const handleConfirm = () => {
                cleanup();
                resolve(true);
            };
            
            const handleClose = () => {
                cleanup();
                resolve(true);
            };
            
            const handleCancel = () => {
                cleanup();
                resolve(false);
            };
            
            popupConfirm.addEventListener('click', handleConfirm);
            popupClose.addEventListener('click', handleClose);
            popupCancel.addEventListener('click', handleCancel);
        });
    }
    
    showCustomConfirm(title, message) {
        return new Promise((resolve) => {
            const popup = document.getElementById('custom-popup');
            const popupTitle = document.getElementById('popup-title');
            const popupMessage = document.getElementById('popup-message');
            const popupCancel = document.getElementById('popup-cancel');
            const popupConfirm = document.getElementById('popup-confirm');
            const popupClose = document.getElementById('popup-close');
            
            popupTitle.textContent = title;
            popupMessage.textContent = message;
            
            // Show both buttons for confirm
            popupCancel.style.display = 'inline-block';
            popupConfirm.textContent = 'Confirm';
            
            popup.style.display = 'flex';
            
            const cleanup = () => {
                popup.style.display = 'none';
                popupConfirm.removeEventListener('click', handleConfirm);
                popupClose.removeEventListener('click', handleClose);
                popupCancel.removeEventListener('click', handleCancel);
            };
            
            const handleConfirm = () => {
                cleanup();
                resolve(true);
            };
            
            const handleClose = () => {
                cleanup();
                resolve(false);
            };
            
            const handleCancel = () => {
                cleanup();
                resolve(false);
            };
            
            popupConfirm.addEventListener('click', handleConfirm);
            popupClose.addEventListener('click', handleClose);
            popupCancel.addEventListener('click', handleCancel);
        });
    }
    
    showCustomPrompt(title, message) {
        return new Promise((resolve) => {
            const popup = document.getElementById('custom-popup');
            const popupTitle = document.getElementById('popup-title');
            const popupMessage = document.getElementById('popup-message');
            const popupCancel = document.getElementById('popup-cancel');
            const popupConfirm = document.getElementById('popup-confirm');
            const popupClose = document.getElementById('popup-close');
            
            popupTitle.textContent = title;
            
            // Create input field
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Enter case number...';
            input.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 1em; margin-top: 10px;';
            
            // Replace message with input
            popupMessage.innerHTML = '';
            popupMessage.appendChild(document.createTextNode(message));
            popupMessage.appendChild(input);
            
            // Show both buttons for prompt
            popupCancel.style.display = 'inline-block';
            popupConfirm.textContent = 'OK';
            
            popup.style.display = 'flex';
            
            // Focus input
            setTimeout(() => input.focus(), 100);
            
            const cleanup = () => {
                popup.style.display = 'none';
                popupMessage.innerHTML = '<p></p>';
                popupConfirm.removeEventListener('click', handleConfirm);
                popupClose.removeEventListener('click', handleClose);
                popupCancel.removeEventListener('click', handleCancel);
                input.removeEventListener('keydown', handleKeydown);
            };
            
            const handleConfirm = () => {
                const value = input.value.trim();
                cleanup();
                resolve(value);
            };
            
            const handleClose = () => {
                cleanup();
                resolve(null);
            };
            
            const handleCancel = () => {
                cleanup();
                resolve(null);
            };
            
            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    handleCancel();
                }
            };
            
            popupConfirm.addEventListener('click', handleConfirm);
            popupClose.addEventListener('click', handleClose);
            popupCancel.addEventListener('click', handleCancel);
            input.addEventListener('keydown', handleKeydown);
        });
    }
    
    showUntrackedCasePrompt(caseNumber) {
        return new Promise((resolve) => {
            const popup = document.getElementById('custom-popup');
            const popupTitle = document.getElementById('popup-title');
            const popupMessage = document.getElementById('popup-message');
            const popupCancel = document.getElementById('popup-cancel');
            const popupConfirm = document.getElementById('popup-confirm');
            const popupClose = document.getElementById('popup-close');
            
            popupTitle.textContent = '⚠️ Case Not Found in CRM';
            popupTitle.style.color = '#f59e0b';
            
            // Create styled container
            const container = document.createElement('div');
            container.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';
            
            // Case number display box
            const caseNumberBox = document.createElement('div');
            caseNumberBox.style.cssText = `
                background: linear-gradient(135deg, #41007F 0%, #5a0099 100%);
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                font-weight: 600;
                text-align: center;
                font-size: 1.1em;
                box-shadow: 0 2px 8px rgba(65, 0, 127, 0.2);
            `;
            caseNumberBox.textContent = `Case #${caseNumber}`;
            
            // Warning message box
            const warningBox = document.createElement('div');
            warningBox.style.cssText = `
                background: #fff3cd;
                border-left: 4px solid #f59e0b;
                padding: 12px 16px;
                border-radius: 6px;
                color: #856404;
                line-height: 1.5;
            `;
            warningBox.innerHTML = `
                <strong style="display: block; margin-bottom: 4px;">⚠️ Not Tracked in CRM</strong>
                <span style="font-size: 0.95em;">This case will not be synced with the CRM system.</span>
            `;
            
            // Instruction text
            const noteText = document.createElement('p');
            noteText.textContent = 'Please provide a case title to continue:';
            noteText.style.cssText = 'margin: 0; font-weight: 500; color: #374151; font-size: 0.95em;';
            
            // Styled input field
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Enter case title...';
            input.style.cssText = `
                width: 100%;
                padding: 12px 16px;
                border: 2px solid #e5e7eb;
                border-radius: 8px;
                font-size: 1em;
                box-sizing: border-box;
                transition: all 0.2s;
                font-family: inherit;
            `;
            
            // Add focus effects
            input.addEventListener('focus', () => {
                input.style.borderColor = '#41007F';
                input.style.boxShadow = '0 0 0 3px rgba(65, 0, 127, 0.1)';
            });
            input.addEventListener('blur', () => {
                input.style.borderColor = '#e5e7eb';
                input.style.boxShadow = 'none';
            });
            
            // Word count display
            const wordCountText = document.createElement('p');
            wordCountText.style.cssText = `
                margin: -4px 0 0 0;
                font-size: 0.85em;
                color: #9ca3af;
                text-align: right;
                font-weight: 500;
            `;
            wordCountText.textContent = '0 / 50 words';
            
            const MAX_WORDS = 50;
            
            // Update word count as user types
            const updateWordCount = () => {
                const text = input.value.trim();
                const words = text ? text.split(/\s+/).filter(word => word.length > 0) : [];
                const wordCount = words.length;
                
                wordCountText.textContent = `${wordCount} / ${MAX_WORDS} words`;
                
                if (wordCount > MAX_WORDS) {
                    wordCountText.style.color = '#dc2626';
                    input.style.borderColor = '#ef4444';
                    input.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
                } else if (wordCount > 0) {
                    wordCountText.style.color = '#059669';
                    input.style.borderColor = '#e5e7eb';
                } else {
                    wordCountText.style.color = '#9ca3af';
                    input.style.borderColor = '#e5e7eb';
                }
            };
            
            input.addEventListener('input', updateWordCount);
            
            // Assemble container
            container.appendChild(caseNumberBox);
            container.appendChild(warningBox);
            container.appendChild(noteText);
            container.appendChild(input);
            container.appendChild(wordCountText);
            
            // Replace message with custom content
            popupMessage.innerHTML = '';
            popupMessage.appendChild(container);
            
            // Show both buttons with enhanced styling
            popupCancel.style.display = 'inline-block';
            popupConfirm.textContent = '✓ Create Case';
            popupConfirm.style.fontWeight = '600';
            
            popup.style.display = 'flex';
            
            // Focus input
            setTimeout(() => input.focus(), 100);
            
            const cleanup = () => {
                popup.style.display = 'none';
                popupMessage.innerHTML = '<p></p>';
                popupTitle.style.color = '';
                popupConfirm.style.fontWeight = '';
                popupConfirm.textContent = 'Confirm';
                popupConfirm.removeEventListener('click', handleConfirm);
                popupClose.removeEventListener('click', handleClose);
                popupCancel.removeEventListener('click', handleCancel);
                input.removeEventListener('keydown', handleKeydown);
            };
            
            const handleConfirm = () => {
                const value = input.value.trim();
                
                // Require case name to be entered
                if (!value) {
                    input.style.borderColor = '#ef4444';
                    input.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
                    input.placeholder = '⚠️ Case title is required';
                    input.focus();
                    return;
                }
                
                // Validate word count (50 words max)
                const words = value.split(/\s+/).filter(word => word.length > 0);
                const wordCount = words.length;
                
                if (wordCount > MAX_WORDS) {
                    input.style.borderColor = '#ef4444';
                    input.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
                    wordCountText.textContent = `❌ Too many words! Limit: ${MAX_WORDS} (currently ${wordCount})`;
                    wordCountText.style.color = '#dc2626';
                    input.focus();
                    return;
                }
                
                cleanup();
                resolve(value); // Return the title
            };
            
            const handleClose = () => {
                cleanup();
                resolve(null); // User cancelled
            };
            
            const handleCancel = () => {
                cleanup();
                resolve(null); // User cancelled
            };
            
            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    handleCancel();
                }
            };
            
            popupConfirm.addEventListener('click', handleConfirm);
            popupClose.addEventListener('click', handleClose);
            popupCancel.addEventListener('click', handleCancel);
            input.addEventListener('keydown', handleKeydown);
        });
    }
    
    // Auto-save current case data
    startAutoSave() {
        setInterval(() => {
            if (this.currentCase) {
                console.log('💾 [Auto-save] Periodic save triggered');
                this.saveCurrentCaseState();
            }
        }, 30000); // Auto-save every 30 seconds
    }
    
    // Check for closed cases that need feedback
    async checkForClosedCases() {
        if (this.userId === null || this.userId === undefined) {
            console.log('No user ID available, skipping closed case check');
            return;
        }
        
        try {
            // Check external CRM status for open cases
            const response = await fetch('/api/cases/check-external-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.log('Could not check external CRM status');
                return;
            }
            
            const responseData = await response.json();
            console.log('🔍 External CRM check response:', responseData);
            const casesNeedingFeedback = responseData.cases_needing_feedback || [];
            console.log('🔒 Cases closed in external CRM:', casesNeedingFeedback);
            
            if (casesNeedingFeedback.length === 0) {
                console.log('✅ No cases closed in external CRM');
                return;
            }
            
            // Check which cases still need feedback
            const casesStillNeedingFeedback = [];
            for (const caseData of casesNeedingFeedback) {
                const feedbackProvided = localStorage.getItem(`feedback-provided-${caseData.case_id}`);
                console.log(`🔍 Checking feedback for case ${caseData.case_id}:`, feedbackProvided ? 'Already provided' : 'Needs feedback');
                if (!feedbackProvided) {
                    casesStillNeedingFeedback.push(caseData);
                }
            }
            
            console.log(`📝 Cases still needing feedback:`, casesStillNeedingFeedback);
            
            if (casesStillNeedingFeedback.length > 0) {
                console.log(`Found ${casesStillNeedingFeedback.length} cases closed in external CRM needing feedback`);
                this.showFeedbackPopup(casesStillNeedingFeedback);
            } else {
                console.log('All cases closed in external CRM already have feedback provided');
            }
            
        } catch (error) {
            console.error('Error checking external CRM status:', error);
        }
    }
    
    // Show feedback popup for closed cases
    showFeedbackPopup(closedCases) {
        this.pendingFeedbackCases = [...closedCases];
        this.currentFeedbackIndex = 0;
        
        // Disable all page interactions
        document.body.style.overflow = 'hidden';
        document.body.style.pointerEvents = 'none';
        
        // Show the feedback popup
        const feedbackPopup = document.getElementById('feedback-popup');
        feedbackPopup.style.display = 'flex';
        feedbackPopup.style.pointerEvents = 'auto';
        
        // Setup event listeners first
        this.setupFeedbackEventListeners();
        
        // Then update the form (which will generate LLM content)
        this.updateFeedbackForm();
    }
    
    // Update feedback form with current case data
    async updateFeedbackForm() {
        const currentCase = this.pendingFeedbackCases[this.currentFeedbackIndex];
        const progressText = document.getElementById('feedback-progress-text');
        const caseNumberSpan = document.getElementById('feedback-case-number');
        const closedDateSpan = document.getElementById('feedback-closed-date');
        
        progressText.textContent = `Case ${this.currentFeedbackIndex + 1} of ${this.pendingFeedbackCases.length}`;
        caseNumberSpan.textContent = currentCase.case_id;
        closedDateSpan.textContent = new Date(currentCase.closed_date || new Date()).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        // Show loading state immediately
        const submitBtn = document.getElementById('feedback-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Generating...';
        submitBtn.classList.add('loading');
        
        // Show loading overlay in popup
        this.showFeedbackLoadingOverlay();
        
        // Clear form first
        document.getElementById('feedback-symptom').value = '';
        document.getElementById('feedback-fault').value = '';
        document.getElementById('feedback-fix').value = '';
        
        try {
            console.log('🤖 Generating LLM feedback for case:', currentCase.case_id);
            
            // Generate LLM feedback
            const response = await fetch('/api/cases/generate-feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    case_number: currentCase.case_id
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                const generatedFeedback = data.generated_feedback;
                
                // Populate form with generated content
                document.getElementById('feedback-symptom').value = generatedFeedback.symptom || '';
                document.getElementById('feedback-fault').value = generatedFeedback.fault || '';
                document.getElementById('feedback-fix').value = generatedFeedback.fix || '';
                
                console.log('✅ Generated feedback for case:', currentCase.case_id);
                console.log('📝 Generated content:', generatedFeedback);
            } else {
                console.error('Failed to generate feedback');
                // Show error message in form
                document.getElementById('feedback-symptom').value = 'Error generating feedback. Please try again.';
                document.getElementById('feedback-fault').value = '';
                document.getElementById('feedback-fix').value = '';
            }
        } catch (error) {
            console.error('Error generating feedback:', error);
            // Show error message in form
            document.getElementById('feedback-symptom').value = 'Error generating feedback. Please try again.';
            document.getElementById('feedback-fault').value = '';
            document.getElementById('feedback-fix').value = '';
        }
        
        // Hide loading overlay
        this.hideFeedbackLoadingOverlay();
        
        // Reset button state
        submitBtn.textContent = 'Submit Feedback';
        submitBtn.classList.remove('loading');
        this.validateFeedbackForm();
    }
    
    // Setup event listeners for feedback form
    setupFeedbackEventListeners() {
        const symptomField = document.getElementById('feedback-symptom');
        const faultField = document.getElementById('feedback-fault');
        const fixField = document.getElementById('feedback-fix');
        const submitBtn = document.getElementById('feedback-submit');
        // Remove existing listeners
        symptomField.removeEventListener('input', this.validateFeedbackForm);
        faultField.removeEventListener('input', this.validateFeedbackForm);
        fixField.removeEventListener('input', this.validateFeedbackForm);
        submitBtn.removeEventListener('click', this.submitFeedback);
        
        // Add new listeners
        this.validateFeedbackForm = this.validateFeedbackForm.bind(this);
        this.submitFeedback = this.submitFeedback.bind(this);
        
        symptomField.addEventListener('input', this.validateFeedbackForm);
        faultField.addEventListener('input', this.validateFeedbackForm);
        fixField.addEventListener('input', this.validateFeedbackForm);
        submitBtn.addEventListener('click', this.submitFeedback);
        
        // Prevent form submission via Enter key
        const form = document.querySelector('.feedback-form');
        form.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
            }
        });
    }
    
    // Validate feedback form
    validateFeedbackForm() {
        const symptom = document.getElementById('feedback-symptom').value.trim();
        const fault = document.getElementById('feedback-fault').value.trim();
        const fix = document.getElementById('feedback-fix').value.trim();
        const submitBtn = document.getElementById('feedback-submit');
        
        const isValid = symptom.length > 0 && fault.length > 0 && fix.length > 0;
        submitBtn.disabled = !isValid;
    }
    
    // Submit feedback for current case
    async submitFeedback() {
        const currentCase = this.pendingFeedbackCases[this.currentFeedbackIndex];
        const symptom = document.getElementById('feedback-symptom').value.trim();
        const fault = document.getElementById('feedback-fault').value.trim();
        const fix = document.getElementById('feedback-fix').value.trim();
        
        // Validation
        if (!symptom || !fault || !fix) {
            this.showFeedbackValidationError('Please fill in all fields before submitting.');
            return;
        }
        
        if (symptom.length < 10 || fault.length < 10 || fix.length < 10) {
            this.showFeedbackValidationError('Please provide more detailed feedback (at least 10 characters per field).');
            return;
        }
        
        const feedbackData = {
            case_number: currentCase.case_id,
            closed_date: currentCase.closed_date,
            feedback: {
                symptom: symptom,
                fault: fault,
                fix: fix
            },
            submitted_at: new Date().toISOString()
        };
        
        try {
            // Submit to backend
            const response = await fetch('/api/cases/feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(feedbackData)
            });
            
            if (response.ok) {
                console.log(`Feedback submitted for case ${currentCase.case_id}`);
                
                // Show success message
                this.showFeedbackSuccessMessage(`Feedback submitted successfully for case ${currentCase.case_id}!`);
                
                // Mark as feedback provided
                localStorage.setItem(`feedback-provided-${currentCase.case_id}`, 'true');
                
                // Immediately remove the case from local cache and sidebar
                const caseManager = window.spellCheckEditor?.caseManager;
                if (caseManager) {
                    console.log('🔄 [Feedback] Removing case from sidebar immediately...');
                    console.log('🔍 [Feedback] CaseManager exists:', !!caseManager);
                    console.log('🔍 [Feedback] Case to remove:', currentCase.case_id);
                    console.log('🔍 [Feedback] Cases before removal:', caseManager.cases.map(c => ({ id: c.id, caseNumber: c.caseNumber, caseTitle: c.caseTitle })));
                    console.log('🔍 [Feedback] Cases count before:', caseManager.cases.length);
                    
                    // Remove from local cases array
                    const originalLength = caseManager.cases.length;
                    caseManager.cases = caseManager.cases.filter(caseData => {
                        const shouldKeep = caseData.caseNumber !== currentCase.case_id;
                        console.log(`🔍 [Feedback] Case ${caseData.caseNumber} (ID: ${caseData.id}): ${shouldKeep ? 'KEEPING' : 'REMOVING'}`);
                        return shouldKeep;
                    });
                    
                    console.log('🔍 [Feedback] Cases after removal:', caseManager.cases.map(c => ({ id: c.id, caseNumber: c.caseNumber, caseTitle: c.caseTitle })));
                    console.log('🔍 [Feedback] Cases count after:', caseManager.cases.length);
                    console.log('🔍 [Feedback] Removed cases count:', originalLength - caseManager.cases.length);
                    
                    // Re-render the sidebar
                    console.log('🔄 [Feedback] Re-rendering sidebar...');
                    caseManager.renderCasesList();
                    
                    // Update active case if needed
                    if (caseManager.currentCase && caseManager.currentCase.caseNumber === currentCase.case_id) {
                        console.log('🔄 [Feedback] Current case was removed, switching to next case...');
                        if (caseManager.cases.length > 0) {
                            console.log('🔄 [Feedback] Switching to first available case:', caseManager.cases[0].id);
                            caseManager.switchToCase(caseManager.cases[0].id);
                        } else {
                            console.log('🔄 [Feedback] No cases left, clearing current case');
                            caseManager.currentCase = null;
                            caseManager.updateActiveCaseHeader();
                        }
                    } else {
                        console.log('🔄 [Feedback] Current case not affected, no switching needed');
                    }
                } else {
                    console.error('❌ [Feedback] CaseManager not available for sidebar removal');
                    console.log('🔍 [Feedback] window.spellCheckEditor:', window.spellCheckEditor);
                    console.log('🔍 [Feedback] window.spellCheckEditor.caseManager:', window.spellCheckEditor?.caseManager);
                }
                
                // Move to next case or close popup after a short delay
                setTimeout(() => {
                    this.currentFeedbackIndex++;
                    if (this.currentFeedbackIndex < this.pendingFeedbackCases.length) {
                        this.updateFeedbackForm();
                    } else {
                        this.closeFeedbackPopup();
                    }
                    
                    // Also refresh from database to ensure consistency
                    const caseManager = window.spellCheckEditor?.caseManager;
                    if (caseManager) {
                        console.log('🔄 [Feedback] Refreshing from database for consistency...');
                        console.log('🔍 [Feedback] Cases before database refresh:', caseManager.cases.map(c => ({ id: c.id, caseNumber: c.caseNumber, caseTitle: c.caseTitle })));
                        caseManager.refreshCases().then(() => {
                            console.log('🔍 [Feedback] Cases after database refresh:', caseManager.cases.map(c => ({ id: c.id, caseNumber: c.caseNumber, caseTitle: c.caseTitle })));
                        });
                    }
                }, 2000); // 2 second delay to show success message
            } else {
                console.error('Failed to submit feedback');
                this.showFeedbackValidationError('Failed to submit feedback. Please try again.');
            }
            
        } catch (error) {
            console.error('Error submitting feedback:', error);
            this.showFeedbackValidationError('Error submitting feedback. Please try again.');
        }
    }
    
    // Close feedback popup
    closeFeedbackPopup() {
        const feedbackPopup = document.getElementById('feedback-popup');
        feedbackPopup.style.display = 'none';
        
        // Re-enable page interactions
        document.body.style.overflow = '';
        document.body.style.pointerEvents = '';
        
        // Clean up
        this.pendingFeedbackCases = [];
        this.currentFeedbackIndex = 0;
    }
}