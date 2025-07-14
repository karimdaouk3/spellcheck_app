class LanguageToolEditor {
    constructor() {
        this.debounceTimer = null;
        this.currentSuggestions = [];
        this.currentMention = null;
        this.highlightOverlay = null;
        this.highlightOverlayInner = null; // New property for the inner content div
        this.ignoredSuggestions = new Set(); // Track ignored suggestions
        this.llmInProgress = false; // Track if LLM call is in progress
        
        this.editor = document.getElementById('editor');
        this.popup = document.getElementById('popup');
        this.status = document.getElementById('status');
        
        this.initEventListeners();
        this.createHighlightOverlay();
    }
    
    createHighlightOverlay() {
        // Remove any existing overlay
        if (this.highlightOverlay && this.highlightOverlay.parentElement) {
            this.highlightOverlay.parentElement.removeChild(this.highlightOverlay);
        }
        // Create overlay container
        this.highlightOverlay = document.createElement('div');
        this.highlightOverlay.className = 'highlight-overlay';
        this.highlightOverlay.style.position = 'absolute';
        this.highlightOverlay.style.top = '0';
        this.highlightOverlay.style.left = '0';
        this.highlightOverlay.style.width = '100%';
        this.highlightOverlay.style.height = '100%';
        this.highlightOverlay.style.pointerEvents = 'none';
        this.highlightOverlay.style.zIndex = '1';
        this.highlightOverlay.style.overflow = 'hidden'; // Only show visible part
        this.highlightOverlay.style.boxSizing = 'border-box';
        this.highlightOverlay.style.background = 'transparent';
        // Create inner content div
        this.highlightOverlayInner = document.createElement('div');
        this.highlightOverlayInner.className = 'highlight-overlay-inner';
        // Copy font, padding, etc. from editor
        const cs = window.getComputedStyle(this.editor);
        this.highlightOverlayInner.style.fontFamily = cs.fontFamily;
        this.highlightOverlayInner.style.fontSize = cs.fontSize;
        this.highlightOverlayInner.style.lineHeight = cs.lineHeight;
        this.highlightOverlayInner.style.padding = cs.padding;
        this.highlightOverlayInner.style.boxSizing = cs.boxSizing;
        this.highlightOverlayInner.style.whiteSpace = 'pre-wrap';
        this.highlightOverlayInner.style.wordBreak = 'break-word';
        this.highlightOverlayInner.style.background = 'transparent';
        this.highlightOverlay.appendChild(this.highlightOverlayInner);
        this.editor.parentElement.appendChild(this.highlightOverlay);
        this.editor.parentElement.style.position = 'relative';
    }
    
    initEventListeners() {
        // Input event for checking text
        this.editor.addEventListener('input', () => {
            this.updateHighlights(); // Immediately update overlay to match text
            this.debounceCheck();
        });
        // Force plain text paste (strip formatting)
        this.editor.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            // Insert plain text at cursor position
            document.execCommand('insertText', false, text);
        });
        // Placeholder logic for contenteditable
        this.editor.addEventListener('focus', () => {
            if (this.editor.innerText.trim() === '') {
                this.editor.classList.remove('empty');
            }
        });
        this.editor.addEventListener('blur', () => {
            if (this.editor.innerText.trim() === '') {
                this.editor.classList.add('empty');
            }
        });
        // Scroll synchronization (if needed)
        this.editor.addEventListener('scroll', () => {
            requestAnimationFrame(() => {
                this.syncOverlayScroll();
            });
        });
        // Hide popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.popup.contains(e.target) && !e.target.classList.contains('highlight-span')) {
                this.hidePopup();
            }
        });
        // Escape key to hide popup
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hidePopup();
            }
        });
        // Initial check if there's existing text
        if (this.editor.innerText.trim()) {
            this.checkText();
        }

        this.popup.querySelector('.ignore-button').addEventListener('click', () => {
            this.ignoreCurrentSuggestion();
        });

        // LLM submit button event
        const llmButton = document.getElementById('llm-submit');
        if (llmButton) {
            llmButton.addEventListener('click', () => {
                const text = this.editor.innerText;
                this.submitToLLM(text);
            });
        }

        // Microphone button logic
        const micBtn = document.getElementById('mic-btn');
        let isRecording = false;
        let mediaRecorder = null;
        let audioChunks = [];
        if (micBtn) {
            micBtn.addEventListener('click', async () => {
                if (!isRecording) {
                    // Start recording
                    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                        alert('Audio recording is not supported in this browser.');
                        return;
                    }
                    this.editor.innerText = '';
                    this.highlightOverlayInner.innerHTML = ''; // Clear inner content
                    this.editor.setAttribute('contenteditable', 'false');
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        mediaRecorder = new window.MediaRecorder(stream);
                        audioChunks = [];
                        mediaRecorder.ondataavailable = (e) => {
                            if (e.data.size > 0) audioChunks.push(e.data);
                        };
                        mediaRecorder.onstop = async () => {
                            micBtn.style.background = '';
                            micBtn.style.color = '';
                            micBtn.disabled = true;
                            this.editor.innerText = 'Processing...';
                            // Send audio to backend
                            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                            const formData = new FormData();
                            formData.append('audio', audioBlob, 'recording.webm');
                            // Wait 1 second to mimic processing
                            setTimeout(async () => {
                                try {
                                    const response = await fetch('/speech-to-text', {
                                        method: 'POST',
                                        body: formData
                                    });
                                    const data = await response.json();
                                    this.editor.innerText = data.transcription || '';
                                    this.checkText();
                                } catch (e) {
                                    this.editor.innerText = 'Error: Could not transcribe.';
                                }
                                micBtn.disabled = false;
                                this.editor.setAttribute('contenteditable', 'true');
                            }, 1000);
                        };
                        mediaRecorder.start();
                        isRecording = true;
                        micBtn.style.background = '#ffebee';
                        micBtn.style.color = '#d32f2f';
                        this.editor.innerText = 'Listening...';
                    } catch (err) {
                        alert('Could not access microphone.');
                    }
                } else {
                    // Stop recording
                    if (mediaRecorder && mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                        isRecording = false;
                    }
                }
            });
        }
    }
    
    debounceCheck() {
        this.showStatus('Checking...', 'checking');
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.checkText();
        }, 1000);
    }
    
    async checkText() {
        const text = this.editor.innerText;
        
        if (!text.trim()) {
            this.clearSuggestions();
            if (!this.llmInProgress) this.showStatus('Ready');
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
                s => !this.ignoredSuggestions.has(this.getSuggestionKey(s, text))
            );
            
            this.currentSuggestions = suggestions;
            this.updateHighlights();
            
            const count = suggestions.length;
            if (!this.llmInProgress) {
                if (count === 0) {
                    this.showStatus('No issues found');
                } else {
                    this.showStatus(`${count} issue${count > 1 ? 's' : ''} found`);
                }
            }
            
        } catch (error) {
            if (!this.llmInProgress) this.showStatus('Error checking text', 'error');
            console.error('Error:', error);
        }
    }
    
    clearSuggestions() {
        this.currentSuggestions = [];
        this.updateHighlights();
    }
    
    updateHighlights() {
        const text = this.editor.innerText;
        if (this.currentSuggestions.length === 0) {
            this.highlightOverlayInner.innerHTML = '';
            return;
        }
        // Create highlighted text
        let highlightedText = '';
        let lastIndex = 0;
        this.currentSuggestions.forEach((suggestion, index) => {
            // Add text before the suggestion
            highlightedText += this.escapeHtml(text.substring(lastIndex, suggestion.offset));
            // Add the highlighted suggestion
            const errorText = text.substring(suggestion.offset, suggestion.offset + suggestion.length);
            highlightedText += `<span class="highlight-span" data-suggestion-index="${index}">${this.escapeHtml(errorText)}</span>`;
            lastIndex = suggestion.offset + suggestion.length;
        });
        // Add any remaining text after the last suggestion
        highlightedText += this.escapeHtml(text.substring(lastIndex));
        this.highlightOverlayInner.innerHTML = highlightedText;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showPopup(suggestion, x, y) {
        const messageDiv = this.popup.querySelector('.popup-message');
        const suggestionsDiv = this.popup.querySelector('.suggestions-list');
        
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
                item.onclick = () => this.applySuggestion(suggestion, replacement);
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
    }
    
    hidePopup() {
        this.popup.style.display = 'none';
        this.currentMention = null;
    }
    
    applySuggestion(suggestion, replacement) {
        // Save selection position and scroll position
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const scrollTop = this.editor.scrollTop;
        const scrollLeft = this.editor.scrollLeft;
        const text = this.editor.innerText;
        const before = text.substring(0, suggestion.offset);
        const after = text.substring(suggestion.offset + suggestion.length);
        this.editor.innerText = before + replacement + after;
        // Restore cursor position after replacement
        const newPosition = suggestion.offset + replacement.length;
        this.setCursorPosition(newPosition);
        // Restore scroll position
        this.editor.scrollTop = scrollTop;
        this.editor.scrollLeft = scrollLeft;
        // Remove the suggestion from currentSuggestions so highlight disappears immediately
        const newText = this.editor.innerText;
        const key = this.getSuggestionKey(suggestion, newText);
        this.currentSuggestions = this.currentSuggestions.filter(
            s => this.getSuggestionKey(s, newText) !== key
        );
        this.updateHighlights();
        requestAnimationFrame(() => this.syncOverlayScroll()); // Ensure overlay is synced after browser updates scroll
        this.hidePopup();
        this.showStatus('Suggestion applied');
        this.editor.focus();
        this.debounceCheck();
    }
    
    showStatus(message, type = 'success', persist = false, removeLoading = false) {
        this.status.textContent = message;
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

    setCursorPosition(pos) {
        // Set cursor at character offset 'pos' in the contenteditable div
        this.editor.focus();
        const textNode = this.editor.firstChild;
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

    ignoreCurrentSuggestion() {
        if (this.currentMention) {
            const text = this.editor.innerText;
            const key = this.getSuggestionKey(this.currentMention, text);
            this.ignoredSuggestions.add(key);
            // Remove from currentSuggestions and update highlights
            this.currentSuggestions = this.currentSuggestions.filter(
                s => this.getSuggestionKey(s, text) !== key
            );
            this.updateHighlights();
        }
        this.hidePopup();
    }

    // Placeholder LLM call
    async submitToLLM(text) {
        this.llmInProgress = true;
        this.showStatus('Reviewing...', 'checking', true); // persist loading message
        this.status.classList.add('loading');
        try {
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = await response.json();
            this.displayLLMResult(data.result);
        } catch (e) {
            this.showStatus('LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            this.status.classList.remove('loading');
            this.llmInProgress = false;
        }
    }

    displayLLMResult(result) {
        const overlay = document.getElementById('llm-result-overlay');
        let html = '';
        let valid = result && typeof result === 'object';
        let rulesObj = result;
        if (valid && result.evaluation && typeof result.evaluation === 'object') {
            rulesObj = result.evaluation;
        }
        if (valid && rulesObj && typeof rulesObj === 'object') {
            // Calculate score
            const keys = Object.keys(rulesObj);
            const total = keys.length;
            const passed = keys.filter(key => rulesObj[key].passed).length;
            html += `<div class="llm-score" style="font-size:1.35em;font-weight:700;margin-bottom:18px;background:#fff;color:#41007F;padding:10px 0 10px 0;border-radius:8px;text-align:center;box-shadow:0 1px 4px rgba(33,0,127,0.07);letter-spacing:0.5px;">Score: <span style="color:#00A7E1;font-size:1.2em;">${passed}</span> <span style="color:#888;font-size:1.1em;">/</span> <span style="color:#00A7E1;">${total}</span></div>`;
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
            if (passedKeys.length > 0) {
                html += `<div style="font-weight:600;font-size:1.08em;color:#4CAF50;margin-bottom:8px;">Completed</div>`;
                for (const key of passedKeys) {
                    const section = rulesObj[key];
                    html += `<div class="llm-section" style="border-left: 4px solid #4CAF50;">
                        <div class="llm-section-title" style="color:#111;"><strong>${this.escapeHtml(key)}</strong></div>
                        <div class="llm-section-justification">${this.escapeHtml(section.justification || '')}</div>
                    </div>`;
                }
            }
            if (failedKeys.length > 0) {
                html += `<div style="font-weight:600;font-size:1.08em;color:#f44336;margin:18px 0 8px 0;">Needs Improvement</div>`;
                for (const key of failedKeys) {
                    const section = rulesObj[key];
                    html += `<div class="llm-section" style="border-left: 4px solid #f44336;">
                        <div class="llm-section-title" style="color:#111;"><strong>${this.escapeHtml(key)}</strong></div>
                        <div class="llm-section-justification">${this.escapeHtml(section.justification || '')}</div>
                    </div>`;
                }
            }
            overlay.innerHTML = html;
            overlay.style.display = 'block';
        } else {
            overlay.style.display = 'none';
        }
        // Show completion message and remove loading spinner at the same time
        requestAnimationFrame(() => {
            if (this.statusTimer) {
                clearTimeout(this.statusTimer);
                this.statusTimer = null;
            }
            this.status.classList.remove('loading');
            this.status.className = 'status';
            this.status.textContent = '';
            this.llmInProgress = false;
        });
        // Show rewrite popup with placeholder or suggested rewrite when LLM overlay is shown
        const rewritePopup = document.getElementById('rewrite-popup');
        if (overlay.style.display === 'block') {
            // If a suggested rewrite is present, show it
            let rewrite = '';
            if (result && typeof result === 'object') {
                if (result.rewritten_problem_statement) {
                    rewrite = result.rewritten_problem_statement;
                } else if (result.rewrite) {
                    rewrite = result.rewrite;
                }
            }
            if (rewrite) {
                rewritePopup.querySelector('.rewrite-content').textContent = rewrite;
            }
            rewritePopup.style.display = 'block';
        } else {
            rewritePopup.style.display = 'none';
        }
    }

    syncOverlayScroll() {
        if (this.highlightOverlay && this.editor) {
            this.highlightOverlay.scrollTop = this.editor.scrollTop;
            this.highlightOverlay.scrollLeft = this.editor.scrollLeft;
        }
    }
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LanguageToolEditor();
});