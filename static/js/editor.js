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
            this.fields.editor2.lastHadContent = (this.getNormalizedText(this.fields.editor2.editor) || '').trim() !== '';
            this.fields.editor2.suppressClearPrompt = false; // to avoid prompts on programmatic clears
            // Initialize the visible label
            const lbl = document.getElementById('line-item-label');
            if (lbl) lbl.textContent = `Line Item: ${this.fields.editor2.lineItemId}`;
        }
        // Initialize Problem Statement version tracking (internal only, no visible label)
        if (this.fields.editor && this.fields.editor.editor) {
            this.fields.editor.problemVersionId = 1; // starts at 1
            this.fields.editor.lastHadContent = (this.getNormalizedText(this.fields.editor.editor) || '').trim() !== '';
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
                            this.setCursorPosition(this.getNormalizedText(fieldObj.editor).length, field);
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
                    const isNowEmpty = this.getNormalizedText(fieldObj.editor).trim() === '';
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
                // Detect transition for Problem Statement (editor) - version tracking (no visible label)
                if (field === 'editor') {
                    const isNowEmpty = this.getNormalizedText(fieldObj.editor).trim() === '';
                    const wasNonEmpty = !!fieldObj.lastHadContent;
                    if (wasNonEmpty && isNowEmpty) {
                        const anchor = fieldObj.editor.closest('.editor-container') || fieldObj.editor.parentElement;
                        this.showYesNoPrompt('Are you starting a new problem statement?', anchor).then((confirmNew) => {
                            if (confirmNew) {
                                const current = typeof fieldObj.problemVersionId === 'number' ? fieldObj.problemVersionId : 1;
                                fieldObj.problemVersionId = current + 1;
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
                if (pill && fieldObj.rewrittenSnapshot && this.getNormalizedText(fieldObj.editor) !== fieldObj.rewrittenSnapshot) {
                    pill.style.display = 'none';
                }
            });
            fieldObj.editor.addEventListener('paste', (e) => {
                e.preventDefault();
                const rawText = (e.clipboardData || window.clipboardData).getData('text');
                
                // Handle empty or invalid text
                if (!rawText || typeof rawText !== 'string') {
                    return;
                }
                
                // Standardize text formatting
                let standardizedText = rawText
                    // Normalize all newline sequences to single \n characters
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    // Remove any excessive whitespace (multiple spaces/tabs)
                    .replace(/[ \t]+/g, ' ')
                    // Remove excessive newlines (more than 2 consecutive)
                    .replace(/\n{3,}/g, '\n\n')
                    // Trim whitespace from start and end
                    .trim();
                
                // Insert the standardized text
                document.execCommand('insertText', false, standardizedText);
            });
            fieldObj.editor.addEventListener('blur', () => {
                if (this.getNormalizedText(fieldObj.editor).trim() === '') {
                    fieldObj.editor.classList.add('empty');
                }
            });
            fieldObj.editor.addEventListener('scroll', () => {
                requestAnimationFrame(() => {
                    this.syncOverlayScroll();
                });
            });
            // Initial check if there's existing text
            if (this.getNormalizedText(fieldObj.editor).trim()) {
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
                    const text = this.getNormalizedText(fieldObj.editor);
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
                        const hadContent = this.getNormalizedText(fieldObj.editor).trim() !== '';
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
                        // For Problem Statement, prompt before starting recording if there was content
                        if (field === 'editor' && hadContent) {
                            const anchor = fieldObj.editor.closest('.editor-container') || fieldObj.editor.parentElement;
                            const confirmNew = await this.showYesNoPrompt('Are you starting a new problem statement?', anchor);
                            if (confirmNew) {
                                const current = typeof fieldObj.problemVersionId === 'number' ? fieldObj.problemVersionId : 1;
                                fieldObj.problemVersionId = current + 1;
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
                                            if (this.getNormalizedText(fieldObj.editor).trim() === '') {
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
                    const text = this.getNormalizedText(fieldObj.editor);
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
        const text = this.getNormalizedText(this.fields[field].editor);
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
        
        // Get text with consistent newline handling
        const text = this.getNormalizedText(fieldObj.editor);
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
    
    // Get text with consistent newline handling to avoid discrepancies between editor and overlay
    getNormalizedText(editor) {
        // Validate input
        if (!editor || typeof editor.textContent === 'undefined') {
            return '';
        }
        
        // Use textContent instead of innerText for more consistent newline handling
        // textContent preserves the original newline structure better than innerText
        let text = editor.textContent || '';
        
        // Normalize all newline sequences to single \n characters
        // This ensures consistency between different browsers and input methods
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        return text;
    }
    
    escapeHtml(text) {
        // Validate input
        if (text === null || text === undefined) {
            return '';
        }
        
        // Convert newlines to <br> tags for proper display in overlay
        // This ensures the overlay maintains the same line structure as the editor
        const escapedText = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\n/g, '<br>');
        
        return escapedText;
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
        const text = this.getNormalizedText(this.fields[field].editor);
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
        const newText = this.getNormalizedText(this.fields[field].editor);
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
        // Validate inputs
        if (!this.fields[field] || !this.fields[field].editor) {
            return;
        }
        
        if (typeof pos !== 'number' || pos < 0) {
            pos = 0;
        }
        
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
            // For step 1, generate and include a unique case_id for correlation
            if (answers) {
                body.answers = answers;
                body.step = 2;
                if (fieldObj.reviewId) body.review_id = fieldObj.reviewId;
                if (fieldObj.userInputId) body.user_input_id = fieldObj.userInputId;
                if (fieldObj.rewriteUuid) body.rewrite_uuid = fieldObj.rewriteUuid;
            } else {
                body.step = 1;
                fieldObj.caseId = this.generateUUIDv4();
                body.case_id = fieldObj.caseId;
            }
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
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
            fieldObj.llmLastResult = data.result;
            // Capture IDs returned from backend for coordination (no DB lookups)
            if (data.result && data.result.user_input_id) {
                fieldObj.userInputId = data.result.user_input_id;
            }
            if (data.result && data.result.rewrite_uuid) {
                fieldObj.rewriteUuid = data.result.rewrite_uuid;
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
                            this.submitToLLM(this.getNormalizedText(fieldObj.editor), toSend, field);
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

    // Create temperature bar with gradient from red to yellow to green
    createTemperatureBar(percentage) {
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        const position = clampedPercentage; // 0-100
        
        return `
            <div style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; font-weight: 600; padding: 4px 0;">
                <span style="color: #000; font-size: 0.9em;">Vague</span>
                <div style="position: relative; width: 140px; height: 18px; background: linear-gradient(to right, #ff6b6b 0%, #ffd93d 50%, #6bcf7f 100%); border-radius: 9px; border: 2px solid #e0e0e0; overflow: visible; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="position: absolute; top: 50%; left: ${position}%; width: 2px; height: 28px; background: linear-gradient(to bottom, #41007F, #5a1a9a); border-radius: 1px; transform: translate(-50%, -50%); border: 1px solid #fff; box-shadow: 0 2px 8px rgba(65,0,127,0.4), 0 0 0 1px rgba(255,255,255,0.8);"></div>
                </div>
                <span style="color: #000; font-size: 0.9em; min-width: 70px;">Thorough</span>
            </div>
            <style>
                @media (max-width: 950px) {
                    .editor-score {
                        font-size: 0.9em !important;
                    }
                    .editor-score > div {
                        gap: 8px !important;
                    }
                    .editor-score > div > div {
                        width: 110px !important;
                        height: 14px !important;
                    }
                    .editor-score > div > div > div:first-child {
                        height: 24px !important;
                        top: 50% !important;
                        transform: translate(-50%, -50%) !important;
                    }
                    .editor-score > div > span {
                        min-width: 0 !important;
                        font-size: 0.9em !important;
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
            
            historyItem.innerHTML = `
                <div style="white-space:pre-wrap;">${textWithNewlines}</div>
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
            if (fieldObj.llmLastResult && fieldObj.llmLastResult.rewrite && fieldObj.llmLastResult.original_text !== this.getNormalizedText(fieldObj.editor)) {
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
                const text = this.getNormalizedText(fieldObj.editor);
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
    new LanguageToolEditor();
    const editor = document.getElementById('editor');
    if (editor) {
                    editor.setAttribute('data-placeholder', 'Start typing your current problem statement here');
    }
});