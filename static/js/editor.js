class LanguageToolEditor {
    constructor() {
        this.debounceTimer = null;
        this.currentSuggestions = [];
        this.currentMention = null;
        this.highlightOverlay = null;
        this.ignoredSuggestions = new Set(); // Track ignored suggestions
        this.llmInProgress = false; // Track if LLM call is in progress
        
        this.editor = document.getElementById('editor');
        this.popup = document.getElementById('popup');
        this.status = document.getElementById('status');
        
        this.initEventListeners();
        this.createHighlightOverlay();
    }
    
    createHighlightOverlay() {
        this.highlightOverlay = document.createElement('div');
        this.highlightOverlay.className = 'highlight-overlay';
        this.highlightOverlay.style.position = 'absolute';
        this.highlightOverlay.style.top = '0';
        this.highlightOverlay.style.left = '0';
        this.highlightOverlay.style.width = '100%';
        this.highlightOverlay.style.height = '100%';
        this.highlightOverlay.style.pointerEvents = 'none';
        this.highlightOverlay.style.zIndex = '1';
        this.highlightOverlay.style.fontFamily = this.editor.style.fontFamily || 'inherit';
        this.highlightOverlay.style.fontSize = this.editor.style.fontSize || '16px';
        this.highlightOverlay.style.lineHeight = this.editor.style.lineHeight || '1.5';
        this.highlightOverlay.style.padding = '15px';
        this.highlightOverlay.style.boxSizing = 'border-box';
        this.highlightOverlay.style.whiteSpace = 'pre-wrap';
        this.highlightOverlay.style.wordWrap = 'break-word';
        
        this.editor.parentElement.appendChild(this.highlightOverlay);
        this.editor.parentElement.style.position = 'relative';
    }
    
    initEventListeners() {
        // Input event for checking text
        this.editor.addEventListener('input', () => {
            this.updateHighlights(); // Immediately update overlay to match text
            this.debounceCheck();
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
                this.highlightOverlay.scrollTop = this.editor.scrollTop;
                this.highlightOverlay.scrollLeft = this.editor.scrollLeft;
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
            this.highlightOverlay.innerHTML = '';
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
        
        // Add remaining text
        highlightedText += this.escapeHtml(text.substring(lastIndex));
        
        this.highlightOverlay.innerHTML = highlightedText;
        
        // Add event listeners to highlighted spans
        const spans = this.highlightOverlay.querySelectorAll('.highlight-span');
        spans.forEach(span => {
            span.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
            span.style.borderBottom = '2px solid #ff6b6b';
            span.style.borderRadius = '2px';
            span.style.cursor = 'pointer';
            span.style.pointerEvents = 'auto';
            
            span.addEventListener('mouseenter', (e) => {
                span.style.backgroundColor = 'rgba(255, 107, 107, 0.3)';
            });
            
            span.addEventListener('mouseleave', (e) => {
                span.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
            });
            
            span.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const suggestionIndex = parseInt(span.getAttribute('data-suggestion-index'));
                const suggestion = this.currentSuggestions[suggestionIndex];
                this.showPopup(suggestion, e.clientX, e.clientY);
            });
        });
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
        // Save selection position
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const text = this.editor.innerText;
        const before = text.substring(0, suggestion.offset);
        const after = text.substring(suggestion.offset + suggestion.length);
        this.editor.innerText = before + replacement + after;
        // Restore cursor position after replacement
        const newPosition = suggestion.offset + replacement.length;
        this.setCursorPosition(newPosition);
        // Remove the suggestion from currentSuggestions so highlight disappears immediately
        const newText = this.editor.innerText;
        const key = this.getSuggestionKey(suggestion, newText);
        this.currentSuggestions = this.currentSuggestions.filter(
            s => this.getSuggestionKey(s, newText) !== key
        );
        this.updateHighlights();
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
        this.showStatus('Submitting to LLM...', 'checking', true); // persist loading message
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
        if (valid) {
            // Calculate score
            const keys = Object.keys(result);
            const total = keys.length;
            const passed = keys.filter(key => result[key].passed).length;
            html += `<div class="llm-score" style="font-size:1.35em;font-weight:700;margin-bottom:18px;background:#e3f2fd;color:#1769aa;padding:10px 0 10px 0;border-radius:8px;text-align:center;box-shadow:0 1px 4px rgba(33,150,243,0.07);letter-spacing:0.5px;">Score: <span style="color:#2196F3;font-size:1.2em;">${passed}</span> / <span style="color:#888;">${total}</span></div>`;
            for (const key in result) {
                if (result.hasOwnProperty(key)) {
                    const section = result[key];
                    html += `<div class="llm-section">
                        <div class="llm-section-title"><strong>${this.escapeHtml(key)}</strong></div>
                        <div class="llm-section-passed">${section.passed ? '<span style=\'color:green\'>Passed</span>' : '<span style=\'color:red\'>Failed</span>'}</div>
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
            this.showStatus('LLM call complete!', valid ? 'success' : 'error', false, true);
            this.llmInProgress = false;
        });
    }
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LanguageToolEditor();
});