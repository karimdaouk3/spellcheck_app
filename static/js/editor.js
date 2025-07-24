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
        this.fields = {
            editor: {
                editor: document.getElementById('editor'),
                micBtn: document.getElementById('mic-btn'),
                submitBtn: document.getElementById('llm-submit'),
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
        this.status = document.getElementById('status');
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
                headerText = 'Problem Statement Feedback';
            } else if (this.activeField === 'editor2') {
                headerText = 'FSR Daily Notes Feedback';
            } else {
                headerText = 'Active Editor Feedback';
            }
            header.textContent = headerText;
        }
    }

    initEventListeners() {
        const charLimits = {
            editor: 1000,
            editor2: 10000
        };
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
            // Character limit enforcement
            const enforceCharLimit = (e) => {
                const limit = charLimits[field];
                let text = fieldObj.editor.innerText;
                if (text.length > limit) {
                    fieldObj.editor.innerText = text.slice(0, limit);
                    this.setCursorPosition(limit, field);
                    alert(`Over the character limit. The limit is ${limit} characters.`);
                }
            };
            fieldObj.editor.addEventListener('input', enforceCharLimit);
            fieldObj.editor.addEventListener('paste', (e) => {
                e.preventDefault();
                const limit = charLimits[field];
                const text = (e.clipboardData || window.clipboardData).getData('text');
                let current = fieldObj.editor.innerText;
                let allowed = text.slice(0, Math.max(0, limit - current.length));
                document.execCommand('insertText', false, allowed);
                if ((current.length + text.length) > limit) {
                    alert(`Over the character limit. The limit is ${limit} characters.`);
                }
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
                    const text = fieldObj.editor.innerText;
                    const limit = charLimits[field];
                    if (text.length > limit) {
                        alert(`Over the character limit. The limit is ${limit} characters.`);
                        return;
                    }
                    if (text.replace(/\s/g, '').length < 20) {
                        alert('Please make sure your problem statement is meaningful and comprehensive (at least 20 characters)');
                        return;
                    }
                    this.submitToLLM(text, null, field); // Only text on first submit, pass field
                });
            }
            // Microphone button logic
            const micBtn = fieldObj.micBtn;
            let isRecording = false;
            let mediaRecorder = null;
            let audioChunks = [];
            if (micBtn) {
                micBtn.addEventListener('click', async () => {
                    this.activeField = field;
                    if (!isRecording) {
                        fieldObj.editor.innerText = '';
                        fieldObj.highlightOverlay.innerHTML = '';
                        fieldObj.editor.setAttribute('data-placeholder', 'Listening...');
                        fieldObj.editor.classList.add('empty');
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
                                micBtn.style.background = '';
                                micBtn.style.color = '';
                                micBtn.disabled = true;
                                this.showStatus('Processing audio...', 'checking', true);
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
                                        fieldObj.editor.innerText = data.transcription || '';
                                        fieldObj.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                        if (fieldObj.editor.innerText.trim() === '') {
                                            fieldObj.editor.classList.add('empty');
                                        } else {
                                            fieldObj.editor.classList.remove('empty');
                                        }
                                        this.checkText(field);
                                        this.llmPlaceholderCall(data.transcription || '');
                                    } catch (e) {
                                        fieldObj.editor.innerText = 'Error: Could not transcribe.';
                                        this.showStatus('Transcription failed', 'error');
                                        fieldObj.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                        fieldObj.editor.classList.remove('empty');
                                    }
                                    micBtn.disabled = false;
                                    fieldObj.editor.setAttribute('contenteditable', 'true');
                                }, 1000);
                            };
                            mediaRecorder.start();
                            isRecording = true;
                            micBtn.style.background = '#ffebee';
                            micBtn.style.color = '#d32f2f';
                            this.showStatus('Listening...', 'recording', true);
                        } catch (err) {
                            fieldObj.editor.innerText = '';
                            fieldObj.editor.setAttribute('contenteditable', 'true');
                            this.showStatus('Could not access microphone.', 'error');
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
    }
    
    debounceCheck(field) {
        this.showStatus('Checking...', 'checking');
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
            if (!fieldObj.llmInProgress) this.showStatus('Ready');
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
                    this.showStatus('No issues found');
                } else {
                    this.showStatus(`${count} issue${count > 1 ? 's' : ''} found`);
                }
            }
            
        } catch (error) {
            if (!fieldObj.llmInProgress) this.showStatus('Error checking text', 'error');
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
                this.saveTerm(text, this.popupField);
                this.ignoreCurrentSuggestion(this.popupField);
                this.hidePopup();
                this.showStatus(`"${text}" added to KLA term bank`, 'success');
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
        this.showStatus('Suggestion applied');
        this.fields[field].editor.focus();
        this.debounceCheck(field);
    }
    
    showStatus(message, type = 'success', persist = false, removeLoading = false) {
        // Add support for a 'recording' type with icon
        let icon = '';
        if (type === 'recording') {
            icon = '<span style="display:inline-flex;align-items:center;margin-right:8px;"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="none" stroke="#fff" stroke-width="2"/><circle cx="10" cy="10" r="5" fill="#fff"/></svg></span>';
        }
        this.status.innerHTML = icon + message;
        this.status.className = `status show ${type}`;
        if (removeLoading) {
            this.status.classList.remove('loading');
        }
        // Clear any previous timer so only the latest message can clear the status
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        if (!persist) {
            this.statusTimer = setTimeout(() => {
                this.status.className = 'status';
                this.statusTimer = null;
            }, 3000);
        }
    }

    setCursorPosition(pos, field) {
        // Set cursor at character offset 'pos' in the contenteditable div
        this.fields[field].editor.focus();
        const textNode = this.fields[field].editor.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            const range = document.createRange();
            range.setStart(textNode, Math.min(pos, textNode.length));
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
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
        fieldObj.llmInProgress = true;
        if (!this.evalCollapsed) this.evalCollapsed = {};
        this.evalCollapsed[field] = true; // Collapse by default after review/rewrite
        if (answers) {
            this.showStatus('Rewriting...', 'checking', true);
        } else {
            this.showStatus('Reviewing...', 'checking', true);
        }
        this.status.classList.add('loading');
        try {
            let body = { text };
            if (answers) {
                body.answers = answers;
                body.step = 2;
            } else {
                body.step = 1;
            }
            // Add ruleset parameter
            if (field === 'editor2') {
                body.ruleset = 'fsr';
            } else {
                body.ruleset = 'problem_statement';
            }
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (typeof data.result === 'object') {
                data.result.original_text = text;
            }
            fieldObj.llmLastResult = data.result;
            this.displayLLMResult(data.result, answers !== null, field);
            this.updateActiveEditorHighlight(); // Ensure highlight remains
        } catch (e) {
            this.showStatus('LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            this.status.classList.remove('loading');
            fieldObj.llmInProgress = false;
            this.updateActiveEditorHighlight(); // Ensure highlight remains
        }
    }

    displayLLMResult(result, showRewrite, field = this.activeField) {
        const fieldObj = this.fields[field];
        const evalBox = document.getElementById('llm-eval-box');
        let html = '';
        let valid = result && typeof result === 'object';
        let rulesObj = result && result.evaluation ? result.evaluation : result;
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        this.status.classList.remove('loading');
        this.status.className = 'status';
        this.status.textContent = '';
        fieldObj.llmInProgress = false;
        // Collapsible state (per field)
        if (!this.evalCollapsed) this.evalCollapsed = {};
        if (typeof this.evalCollapsed[field] === 'undefined') this.evalCollapsed[field] = true;
        const isCollapsed = this.evalCollapsed[field];
        if (valid && rulesObj && typeof rulesObj === 'object') {
            const keys = Object.keys(rulesObj);
            const total = keys.length;
            const passed = keys.filter(key => rulesObj[key].passed).length;
            let inputType = '';
            if (field === 'editor') {
                inputType = 'Problem Statement Feedback';
            } else if (field === 'editor2') {
                inputType = 'FSR Daily Notes Feedback';
            } else {
                inputType = 'Input Feedback';
            }
            // Replace score box with feedback title
            html += `<div class="llm-score" style="font-size:1.35em;font-weight:700;margin-bottom:0;background:#fff;color:#41007F;padding:10px 0 10px 0;border-radius:8px;text-align:center;box-shadow:0 1px 4px rgba(33,0,127,0.07);letter-spacing:0.5px;display:flex;align-items:center;justify-content:center;gap:10px;position:relative;">\n` +
                `<button id="eval-collapse-btn" title="Click to expand for details" style="background:none;border:none;cursor:pointer;padding:0 6px;outline:none;display:inline-flex;align-items:center;justify-content:center;position:absolute;left:0;top:50%;transform:translateY(-50%) ${isCollapsed ? 'rotate(-90deg)' : ''};height:100%;z-index:2;">\n` +
                `<span id="eval-chevron" style="font-size:1.3em;transition:transform 0.2s;">&#9660;</span>\n` +
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
                // Separate passed and failed
                const passedKeys = sortedKeys.filter(key => rulesObj[key].passed);
                const failedKeys = sortedKeys.filter(key => !rulesObj[key].passed);
                // Show Needs Improvement first, then Completed
                if (failedKeys.length > 0) {
                    html += `<div style="font-weight:600;font-size:1.08em;color:#f44336;margin:18px 0 8px 0;">Needs Improvement</div>`;
                    for (const key of failedKeys) {
                        const section = rulesObj[key];
                        html += `
                            <div class="llm-section llm-dropdown open" data-passed="false">
                                <div class="llm-section-header" tabindex="0">
                                    <span class="llm-dropdown-arrow open">&#9660;</span>
                                    <span class="llm-section-title" style="color:#111;" data-criteria="${this.escapeHtml(key)}"><strong>${this.escapeHtml(key)}</strong></span>
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
                        html += `
                            <div class="llm-section llm-dropdown" data-passed="true">
                                <div class="llm-section-header" tabindex="0">
                                    <span class="llm-dropdown-arrow">&#9654;</span>
                                    <span class="llm-section-title" style="color:#111;" data-criteria="${this.escapeHtml(key)}"><strong>${this.escapeHtml(key)}</strong></span>
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
            }
        } else {
            evalBox.innerHTML = '';
            evalBox.style.display = 'none';
            return;
        }
        evalBox.innerHTML = html;
        evalBox.style.display = 'flex';
        // Add collapse/expand logic
        const collapseBtn = document.getElementById('eval-collapse-btn');
        if (collapseBtn) {
            collapseBtn.onclick = () => {
                this.evalCollapsed[field] = !this.evalCollapsed[field];
                this.displayLLMResult(result, showRewrite, field);
            };
        }
        // Dropdown logic (unchanged)
        const dropdowns = evalBox.querySelectorAll('.llm-dropdown');
        dropdowns.forEach(dropdown => {
            const header = dropdown.querySelector('.llm-section-header');
            const justification = dropdown.querySelector('.llm-section-justification');
            const arrow = dropdown.querySelector('.llm-dropdown-arrow');
            // Set initial state
            if (dropdown.classList.contains('open')) {
                justification.style.display = 'block';
                arrow.classList.add('open');
                arrow.innerHTML = '&#9660;';
            } else {
                justification.style.display = 'none';
                arrow.classList.remove('open');
                arrow.innerHTML = '&#9654;';
            }
            // Toggle on click or enter/space
            header.addEventListener('click', () => {
                dropdown.classList.toggle('open');
                const isOpen = dropdown.classList.contains('open');
                justification.style.display = isOpen ? 'block' : 'none';
                arrow.innerHTML = isOpen ? '&#9660;' : '&#9654;';
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
                e.stopPropagation(); // Prevent dropdown toggle
                const criteria = title.getAttribute('data-criteria');
                const rewritePopup = document.getElementById('rewrite-popup');
                
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
                    }
                }
            });
        });

        const feedbackBtns = evalBox.querySelectorAll('.llm-feedback-btn'); // Changed to evalBox
        feedbackBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const criteria = btn.getAttribute('data-criteria');
                const text = fieldObj.editor.innerText;
                // Show feedback box if not already present
                let card = btn.closest('.llm-section');
                if (!card) return;
                let feedbackBox = card.querySelector('.llm-feedback-box');
                btn.classList.add('selected');
                if (!feedbackBox) {
                    feedbackBox = document.createElement('div');
                    feedbackBox.className = 'llm-feedback-box';
                    feedbackBox.style.marginTop = '0px';
                    feedbackBox.innerHTML = `<textarea class="llm-feedback-text" rows="1" placeholder="Please Give Feedback"></textarea><button class="llm-feedback-submit" title="Send Feedback"> <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><line x1='22' y1='2' x2='11' y2='13'/><polygon points='22 2 15 22 11 13 2 9 22 2'/></svg></button>`;
                    card.appendChild(feedbackBox);
                    // Add vertical space below feedback box
                    const feedbackSpace = document.createElement('div');
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
                        // Log feedback (console.log for now, or send to backend)
                        fetch('/feedback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                criteria,
                                text,
                                feedback: 'thumbs_down',
                                explanation: feedbackText,
                                passed
                            })
                        }).then(res => res.json()).then(data => {
                            btn.classList.add('selected');
                            btn.title = "Feedback received!";
                            feedbackBox.remove();
                            feedbackSpace.remove();
                            
                            // Move evaluation to completed and update score
                            if (fieldObj.llmLastResult && fieldObj.llmLastResult.evaluation && fieldObj.llmLastResult.evaluation[criteria]) {
                                // Mark this criteria as passed
                                fieldObj.llmLastResult.evaluation[criteria].passed = true;
                                
                                // Update the score display
                                this.updateEditorLabelsWithScore();
                                
                                // Re-render the evaluation display to move it to "Completed" section
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
                }
            });
        });

        // --- Questions and rewrite popup logic ---
        const rewritePopup = document.getElementById('rewrite-popup');
        if (!showRewrite) {
            // Show questions for failed criteria
            fieldObj.llmQuestions = [];
            fieldObj.llmAnswers = {};
            if (rulesObj) {
                for (const key of Object.keys(rulesObj)) {
                    const section = rulesObj[key];
                    if (!section.passed && section.question) {
                        fieldObj.llmQuestions.push({ criteria: key, question: section.question });
                    }
                }
            }
            if (fieldObj.llmQuestions.length > 0) {
                // Determine color based on active editor
                const isProblemStatement = field === 'editor';
                const borderColor = isProblemStatement ? '#41007F' : '#00A7E1';
                const backgroundColor = isProblemStatement ? 'rgba(240, 240, 255, 0.3)' : 'rgba(240, 248, 255, 0.3)';
                
                let qHtml = '<div class="rewrite-title" style="display:flex;align-items:center;font-weight:700;font-size:1.13em;color:#41007F;margin-bottom:8px;">To improve your input, please answer the following questions:</div>';
                qHtml += `<div class="rewrite-title" style="border: 2px solid ${borderColor}; background: ${backgroundColor}; border-radius: 10px; padding: 18px 18px 10px 18px; margin-bottom: 10px; margin-top: 10px;">`;
                fieldObj.llmQuestions.forEach((q, idx) => {
                    qHtml += `<div class="rewrite-question">${this.escapeHtml(q.question)}</div>`;
                    qHtml += `<textarea class="rewrite-answer" data-criteria="${this.escapeHtml(q.criteria)}" rows="1" style="width:100%;margin-bottom:12px;resize:none;"></textarea>`;
                });
                qHtml += `<button id="submit-answers-btn" class="llm-submit-button" style="margin-top:10px;">Rewrite</button>`;
                rewritePopup.innerHTML = qHtml;
                rewritePopup.style.display = 'block';
                // Add event listener for submit answers
                setTimeout(() => {
                    const btn = document.getElementById('submit-answers-btn');
                    const answerEls = rewritePopup.querySelectorAll('.rewrite-answer');
                    // Prevent newlines and blur on Enter in rewrite answer boxes
                    answerEls.forEach(el => {
                        el.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                el.blur();
                            }
                        });
                    });
                    if (btn) {
                        btn.onclick = () => {
                            // Collect answers
                            answerEls.forEach(el => {
                                const crit = el.getAttribute('data-criteria');
                                fieldObj.llmAnswers[crit] = el.value;
                            });
                            // Log rewrite submission
                            if (fieldObj.llmQuestions && fieldObj.llmQuestions.length > 0) {
                                const logArr = fieldObj.llmQuestions.map(q => ({
                                    original_text: fieldObj.editor.innerText,
                                    criteria: q.criteria,
                                    question: q.question,
                                    user_answer: fieldObj.llmAnswers[q.criteria] || ''
                                }));
                                fetch('/rewrite-feedback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(logArr)
                                });
                            }
                            // Resubmit to LLM with answers
                            this.submitToLLM(fieldObj.editor.innerText, fieldObj.llmAnswers, field);
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
                // Add the version that was submitted (before rewrite) to history
                this.addToHistory(fieldObj.editor.innerText, field);
                // Replace the editor content with the rewrite
                fieldObj.editor.innerText = rewrite;
                // Hide overlay immediately to prevent flash of old highlights
                fieldObj.overlayHidden = true;
                this.updateHighlights(field);
                // Hide the rewrite popup and overlay
                rewritePopup.style.display = 'none';
                evalBox.style.display = 'none'; // Hide evaluation box as well
                // Update overlay for new text
                this.checkText(field);
                // Trigger a review (LLM evaluation) for the new text
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

    // Update the label/title of each text box to include the score
    updateEditorLabelsWithScore() {
        const score1 = document.getElementById('score-editor');
        const score2 = document.getElementById('score-editor2');
        const r1 = this.fields['editor'].llmLastResult;
        const r2 = this.fields['editor2'].llmLastResult;
        
        // Update Problem Statement score
        if (r1 && r1.evaluation) {
            const keys = Object.keys(r1.evaluation);
            const total = keys.length;
            const passed = keys.filter(k => r1.evaluation[k].passed).length;
            const percentage = total > 0 ? (passed / total) : 0;
            
            score1.textContent = `Current Score: ${passed}/${total}`;
            score1.className = 'editor-score';
            
            // Color coding based on performance
            if (percentage >= 2/3) {
                score1.style.backgroundColor = '#4CAF50';
                score1.style.color = 'white';
            } else if (percentage >= 1/3) {
                score1.style.backgroundColor = '#FFC107';
                score1.style.color = 'black';
            } else {
                score1.style.backgroundColor = '#F44336';
                score1.style.color = 'white';
            }
        } else {
            score1.textContent = '';
            score1.className = 'editor-score';
            score1.style.backgroundColor = '';
            score1.style.color = '';
        }
        
        // Update FSR Daily Notes score
        if (r2 && r2.evaluation) {
            const keys = Object.keys(r2.evaluation);
            const total = keys.length;
            const passed = keys.filter(k => r2.evaluation[k].passed).length;
            const percentage = total > 0 ? (passed / total) : 0;
            
            score2.textContent = `Current Score: ${passed}/${total}`;
            score2.className = 'editor-score';
            
            // Color coding based on performance
            if (percentage >= 2/3) {
                score2.style.backgroundColor = '#4CAF50';
                score2.style.color = 'white';
            } else if (percentage >= 1/3) {
                score2.style.backgroundColor = '#FFC107';
                score2.style.color = 'black';
            } else {
                score2.style.backgroundColor = '#F44336';
                score2.style.color = 'white';
            }
        } else {
            score2.textContent = '';
            score2.className = 'editor-score';
            score2.style.backgroundColor = '';
            score2.style.color = '';
        }
    }

    // --- Placeholder for LLM call after transcription ---
    llmPlaceholderCall(transcription) {
        if (!transcription || transcription.trim() === '') return;
        // TODO: Replace this with your actual LLM call logic
        console.log('LLM placeholder: would process transcription:', transcription);
        // Example: this.submitToLLM(transcription);
    }

    saveTerm(term, field) {
        // Send the term to the backend
        fetch('/terms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term })
        })
        .then(res => {
            if (!res.ok) throw new Error('Failed to add term');
            // No need to check for data.terms anymore
            // Rerun spellcheck for both boxes so new terms are no longer highlighted
            this.checkText('editor');
            this.checkText('editor2');
        })
        .catch(() => {
            this.showStatus('Failed to add term', 'error');
        });
    }

    addToHistory(text, field = this.activeField) {
        if (!text || !text.trim()) return;
        const fieldObj = this.fields[field];
        fieldObj.history.unshift(text);
        if (fieldObj.history.length > 50) fieldObj.history = fieldObj.history.slice(0, 50);
        this.renderHistory();
    }

    renderHistory() {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';
        // Update the history label dynamically
        const historyLabel = document.getElementById('history-label');
        let label = '';
        if (this.activeField === 'editor') {
            label = 'Problem Statement History';
        } else if (this.activeField === 'editor2') {
            label = 'FSR Daily Notes History';
        } else {
            label = 'Input History';
        }
        if (historyLabel) historyLabel.textContent = label;
        const fieldObj = this.fields[this.activeField];
        fieldObj.history.forEach((item, idx) => {
            const li = document.createElement('li');
            li.textContent = item; // Show full text, no truncation
            li.title = item;
            // Add history icon for restore
            const icon = document.createElement('span');
            icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 512 512" fill="#41007F" style="display:inline-block;vertical-align:middle;"><path d="M256 64C150 64 64 150 64 256H16l80 96 80-96h-48c0-88.2 71.8-160 160-160s160 71.8 160 160-71.8 160-160 160c-39.7 0-76.1-14.3-104.2-37.9-6.9-5.7-17.1-4.7-22.8 2.2s-4.7 17.1 2.2 22.8C163.7 426.2 207.6 448 256 448c106 0 192-86 192-192S362 64 256 64z"/></svg>';
            icon.style.float = 'right';
            icon.style.cursor = 'pointer';
            icon.style.marginLeft = '12px';
            icon.style.display = 'inline-flex';
            icon.style.alignItems = 'center';
            icon.style.padding = '4px';
            icon.style.borderRadius = '4px';
            icon.style.transition = 'background-color 0.2s';
            icon.title = 'Restore to editor';
            icon.onmouseenter = () => {
                icon.style.backgroundColor = '#e0e6f7';
            };
            icon.onmouseleave = () => {
                icon.style.backgroundColor = 'transparent';
            };
            icon.onclick = (e) => {
                e.stopPropagation();
                fieldObj.editor.innerText = item;
            };
            li.appendChild(icon);
            // Remove item click/hover highlight
            li.style.cursor = 'default';
            li.onmouseenter = null;
            li.onmouseleave = null;
            li.onclick = null;
            this.historyList.appendChild(li);
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
        const rewritePopup = document.getElementById('rewrite-popup');
        if (rewritePopup) {
            rewritePopup.style.display = 'none';
        }
        // Now show the correct evaluation if it exists for this field
        const fieldObj = this.fields[field];
        // If the last result was a rewrite, and the editor content doesn't match, clear it
        if (fieldObj.llmLastResult && fieldObj.llmLastResult.rewrite && fieldObj.llmLastResult.original_text !== fieldObj.editor.innerText) {
            fieldObj.llmLastResult = null;
        }
        if (fieldObj.llmLastResult) {
            // Only show if the result matches the current editor content (avoid showing stale result)
            if (fieldObj.llmLastResult.original_text === undefined || fieldObj.llmLastResult.original_text === fieldObj.editor.innerText) {
                this.displayLLMResult(fieldObj.llmLastResult, false, field);
            }
        }
        this.updateActiveEditorHighlight(); // Always re-apply highlight after UI update
    }
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LanguageToolEditor();
    const editor = document.getElementById('editor');
    if (editor) {
        editor.setAttribute('data-placeholder', 'Start typing your problem statement here');
    }
});