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
                if (!fieldObj.overlayHidden) {
                    this.updateHighlights(field); // Only update overlay if not hidden
                }
                this.debounceCheck(field);
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
                            
                            // Change icon to white square when recording
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
                    // Prevent multiple clicks while showing feedback
                    if (copyBtn.disabled) return;
                    
                    const text = fieldObj.editor.innerText;
                    if (text.trim() === '') {
                        // Show error feedback on the button itself
                        const originalHTML = copyBtn.innerHTML;
                        copyBtn.disabled = true;
                        copyBtn.style.pointerEvents = 'none';
                        copyBtn.innerHTML = '<span style="color: #666; font-size: 0.8em;">Nothing to copy</span>';
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHTML;
                            copyBtn.disabled = false;
                            copyBtn.style.pointerEvents = '';
                        }, 1500);
                        return;
                    }
                    
                    try {
                        await navigator.clipboard.writeText(text);
                        
                        // Success feedback - change button text
                        const originalHTML = copyBtn.innerHTML;
                        copyBtn.disabled = true;
                        copyBtn.style.pointerEvents = 'none';
                        copyBtn.innerHTML = '<span style="color: #666; font-size: 0.8em;">Copied!</span>';
                        
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHTML;
                            copyBtn.disabled = false;
                            copyBtn.style.pointerEvents = '';
                        }, 1500);
                        
                    } catch (err) {
                        // Error feedback - change button text
                        const originalHTML = copyBtn.innerHTML;
                        copyBtn.disabled = true;
                        copyBtn.style.pointerEvents = 'none';
                        copyBtn.innerHTML = '<span style="color: #666; font-size: 0.8em;">Copy failed</span>';
                        
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHTML;
                            copyBtn.disabled = false;
                            copyBtn.style.pointerEvents = '';
                        }, 1500);
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
            
            // Add to history when submitting for evaluation (not rewrite)
            if (!answers) {
                this.addToHistory(text, field, data.result);
                // Log evaluation data
                this.logEvaluationData(text, data.result, field);
            }
            
            this.displayLLMResult(data.result, answers !== null, field);
            this.updateActiveEditorHighlight(); // Ensure highlight remains
        } catch (e) {
            alert('LLM call failed: ' + e);
            fieldObj.llmInProgress = false;
            this.resetButtonState(field);
            this.updateActiveEditorHighlight(); // Ensure highlight remains
        }
    }

    displayLLMResult(result, showRewrite, field = this.activeField) {
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
        // Collapsible state (per field)
        if (!this.evalCollapsed) this.evalCollapsed = {};
        if (typeof this.evalCollapsed[field] === 'undefined') this.evalCollapsed[field] = true; // Collapsed by default
        // After rewrite, always close the feedback dropdown
        if (showRewrite) {
            this.evalCollapsed[field] = true;
        }
        const isCollapsed = this.evalCollapsed[field];
        
        if (valid && rulesObj && typeof rulesObj === 'object') {
            const keys = Object.keys(rulesObj);
            const total = keys.length;
            const passed = keys.filter(key => rulesObj[key].passed).length;
            let inputType = 'How Your Score Was Calculated';
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
        
        // Check if button exists immediately after setting HTML
        setTimeout(() => {
            const btnCheck = document.getElementById('eval-collapse-btn');
            if (btnCheck) {
                btnCheck.onclick = () => {
                    this.evalCollapsed[field] = !this.evalCollapsed[field];
                    this.displayLLMResult(result, showRewrite, field);
                };
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
            fieldObj.llmQuestions = [];
            // Clear previous answers when new questions are generated
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
                    // Prepopulate answer if we're restoring from history OR if we have saved answers
                    const existingAnswer = (fieldObj.isRestoringFromHistory || fieldObj.llmAnswers[q.criteria]) ? (fieldObj.llmAnswers[q.criteria] || '') : '';
                    qHtml += `<textarea class="rewrite-answer" data-criteria="${this.escapeHtml(q.criteria)}" rows="1" style="width:100%;margin-bottom:12px;resize:none;">${this.escapeHtml(existingAnswer)}</textarea>`;
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
                            // Collect answers (redundant, but ensures latest values)
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
                fieldObj.editor.innerText = rewrite;
                fieldObj.overlayHidden = true;
                this.updateHighlights(field);
                rewritePopup.style.display = 'none';
                evalBox.style.display = 'none';
                this.checkText(field);
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
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9em; font-weight: 600;">
                <span style="color: #000;">Vague</span>
                <div style="position: relative; width: 120px; height: 20px; background: linear-gradient(to right, #ff4444 0%, #ffaa00 50%, #44ff44 100%); border-radius: 10px; border: 2px solid #ddd; overflow: hidden;">
                    <div style="position: absolute; top: -4px; left: 50%; width: 2px; height: 28px; background: #f01e69; border-radius: 1px; transform: translateX(-50%);"></div>
                    <div style="position: absolute; top: 0; left: ${position}%; width: 3px; height: 100%; background: #fff; border-radius: 1px; transform: translateX(-50%); box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>
                </div>
                <span style="color: #000; min-width: 60px;">Thorough</span>
            </div>
        `;
    }

    // Load rulesets from backend
    async loadRulesets() {
        try {
            const [problemStatementRuleset, fsrRuleset] = await Promise.all([
                fetch('/ruleset/problem_statement').then(res => res.json()),
                fetch('/ruleset/fsr').then(res => res.json())
            ]);
            
            this.rulesets = {
                editor: problemStatementRuleset,
                editor2: fsrRuleset
            };
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
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.style.cssText = 'padding:10px;margin:5px 0;background:#f9f9f9;border-radius:5px;cursor:pointer;border-left:3px solid #41007F;';
            historyItem.title = 'Click to revert to this version';
            
            const text = typeof item === 'string' ? item : item.text;
            const llmResult = typeof item === 'object' ? item.llmLastResult : null;
            
            // Calculate score if available
            let scoreDisplay = '';
            if (llmResult && llmResult.evaluation) {
                const score = this.calculateWeightedScore(this.activeField, llmResult.evaluation);
                const percentage = Math.round(score);
                scoreDisplay = this.createTemperatureBar(percentage);
            }
            
            // Replace newlines with <br> tags for proper rendering
            const textWithNewlines = text.replace(/\n/g, '<br>');
            
            historyItem.innerHTML = `
                <div style="margin-bottom:5px;white-space:pre-wrap;">${textWithNewlines}</div>
                ${scoreDisplay ? `<div style="margin-top:5px;">${scoreDisplay}</div>` : ''}
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
                    html += `<div class="llm-dropdown-arrow" style="color:#666;font-size:0.9em;transition:transform 0.2s;">&#9654;</div>\n`;
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
                // Use the last result for this field if available
                const lastResult = this.fields[field].llmLastResult;
                if (lastResult) {
                    this.renderEvaluationOnly(lastResult, field);
                }
            };
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
                arrow.innerHTML = '&#9660;';
            } else {
                justification.style.display = 'none';
                arrow.classList.remove('open');
                arrow.innerHTML = '&#9654;';
            }
            // Toggle on click or enter/space
            header.addEventListener('click', (e) => {
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
    
    // Log evaluation data to backend
    async logEvaluationData(text, result, field) {
        try {
            // Calculate score
            const evaluation = result && result.evaluation ? result.evaluation : result;
            const score = this.calculateWeightedScore(field, evaluation);
            
            // Extract criteria (all evaluation keys)
            const criteria = evaluation ? Object.keys(evaluation) : [];
            
            // Create timestamp
            const timestamp = new Date().toISOString();
            
            // Prepare data for backend
            const logData = {
                text: text,
                score: score,
                criteria: criteria,
                timestamp: timestamp
            };
            
            // Send to backend
            await fetch('/llm-evaluation-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(logData)
            });
            
        } catch (error) {
            console.error('Failed to log evaluation data:', error);
            // Don't show error to user as this is just logging
        }
    }
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LanguageToolEditor();
    const editor = document.getElementById('editor');
    if (editor) {
                    editor.setAttribute('data-placeholder', 'Start typing your current problem statement here');
    }
});