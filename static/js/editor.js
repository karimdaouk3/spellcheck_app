class LanguageToolEditor {
    constructor() {
        // State for both fields
        this.fields = {
            problem: this.createFieldState('problem'),
            fsr: this.createFieldState('fsr')
        };
        this.activeField = 'problem';
        this.initEventListeners();
        this.switchField('problem');
    }

    createFieldState(field) {
        return {
            debounceTimer: null,
            currentSuggestions: [],
            currentMention: null,
            highlightOverlay: null,
            ignoredSuggestions: new Set(),
            llmInProgress: false,
            overlayHidden: false,
            awaitingCheck: false,
            llmQuestions: [],
            llmAnswers: {},
            llmLastResult: null,
            history: [],
            editor: document.getElementById(`editor-${field}`),
            popup: document.getElementById('popup'),
            status: document.getElementById('status'),
            historyList: document.getElementById('history-list'),
        };
    }

    switchField(field) {
        this.activeField = field;
        // Update UI: set both editors to inactive, then activate the selected one
        ['problem', 'fsr'].forEach(f => {
            const ed = this.fields[f].editor;
            if (ed) ed.classList.remove('active-editor');
        });
        this.fields[field].editor.classList.add('active-editor');
        // Render history for the active field
        this.renderHistory();
        // Render evaluation and rewrite for the active field
        this.displayLLMResult(this.fields[field].llmLastResult, false, true);
    }

    initEventListeners() {
        // Editor focus switches active field
        ['problem', 'fsr'].forEach(field => {
            const ed = this.fields[field].editor;
            if (ed) {
                ed.addEventListener('focus', () => this.switchField(field));
                ed.addEventListener('input', () => {
                    if (!this.fields[field].overlayHidden) {
                        this.updateHighlights(field);
                    }
                    this.debounceCheck(field);
                });
                ed.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const text = (e.clipboardData || window.clipboardData).getData('text');
                    document.execCommand('insertText', false, text);
                });
                // Scroll synchronization for overlay
                ed.addEventListener('scroll', () => {
                    this.syncOverlayScroll(field);
                });
            }
        });
        // Submit buttons
        document.getElementById('llm-submit-problem').addEventListener('click', () => {
            this.switchField('problem');
            this.submitToLLM('problem', this.fields['problem'].editor.innerText);
        });
        document.getElementById('llm-submit-fsr').addEventListener('click', () => {
            this.switchField('fsr');
            this.submitToLLM('fsr', this.fields['fsr'].editor.innerText);
        });
        // Microphone buttons
        this.initMicButton('problem');
        this.initMicButton('fsr');
        // Hide popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.fields[this.activeField].popup.contains(e.target) && !e.target.classList.contains('highlight-span')) {
                this.hidePopup(this.activeField);
            }
        });
        // Escape key to hide popup
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hidePopup(this.activeField);
            }
        });
    }

    debounceCheck(field) {
        const state = this.fields[field];
        state.status.textContent = 'Checking...';
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(() => {
            this.checkText(field);
        }, 1000);
    }

    async checkText(field) {
        const state = this.fields[field];
        const text = state.editor.innerText;
        if (!text.trim()) {
            this.clearSuggestions(field);
            if (!state.llmInProgress) state.status.textContent = 'Ready';
            return;
        }
        try {
            const response = await fetch('/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const suggestionsRaw = await response.json();
            const suggestions = suggestionsRaw.filter(
                s => !state.ignoredSuggestions.has(this.getSuggestionKey(s, text))
            );
            state.currentSuggestions = suggestions;
            state.awaitingCheck = false;
            state.overlayHidden = false;
            this.updateHighlights(field);
            const count = suggestions.length;
            if (!state.llmInProgress) {
                state.status.textContent = count === 0 ? 'No issues found' : `${count} issue${count > 1 ? 's' : ''} found`;
            }
        } catch (error) {
            if (!state.llmInProgress) state.status.textContent = 'Error checking text';
        }
    }

    clearSuggestions(field) {
        this.fields[field].currentSuggestions = [];
        this.updateHighlights(field);
    }

    updateHighlights(field) {
        const state = this.fields[field];
        if (state.awaitingCheck || state.overlayHidden) {
            if (state.highlightOverlay) state.highlightOverlay.innerHTML = '';
            return;
        }
        const text = state.editor.innerText;
        if (state.currentSuggestions.length === 0) {
            if (state.highlightOverlay) state.highlightOverlay.innerHTML = '';
            return;
        }
        if (!state.highlightOverlay) {
            state.highlightOverlay = document.createElement('div');
            state.highlightOverlay.className = 'highlight-overlay';
            state.highlightOverlay.style.position = 'absolute';
            state.highlightOverlay.style.top = '0';
            state.highlightOverlay.style.left = '0';
            state.highlightOverlay.style.width = '100%';
            state.highlightOverlay.style.height = '100%';
            state.highlightOverlay.style.pointerEvents = 'none';
            state.highlightOverlay.style.zIndex = '1';
            state.highlightOverlay.style.fontFamily = state.editor.style.fontFamily || 'inherit';
            state.highlightOverlay.style.fontSize = state.editor.style.fontSize || '16px';
            state.highlightOverlay.style.lineHeight = state.editor.style.lineHeight || '1.5';
            state.highlightOverlay.style.padding = '15px';
            state.highlightOverlay.style.boxSizing = 'border-box';
            state.highlightOverlay.style.whiteSpace = 'pre-wrap';
            state.highlightOverlay.style.wordBreak = 'break-word';
            state.highlightOverlay.style.background = 'transparent';
            state.editor.parentElement.appendChild(state.highlightOverlay);
            state.editor.parentElement.style.position = 'relative';
        }
        let highlightedText = '';
        let lastIndex = 0;
        state.currentSuggestions.forEach((suggestion, index) => {
            highlightedText += this.escapeHtml(text.substring(lastIndex, suggestion.offset));
            const errorText = text.substring(suggestion.offset, suggestion.offset + suggestion.length);
            let categoryClass = '';
            if (suggestion.errorType === 'spelling') categoryClass = 'highlight-span-spelling';
            else if (suggestion.errorType === 'grammar') categoryClass = 'highlight-span-grammar';
            else if (suggestion.errorType) categoryClass = 'highlight-span-other';
            highlightedText += `<span class="highlight-span ${categoryClass}" data-suggestion-index="${index}">${this.escapeHtml(errorText)}</span>`;
            lastIndex = suggestion.offset + suggestion.length;
        });
        highlightedText += this.escapeHtml(text.substring(lastIndex));
        state.highlightOverlay.innerHTML = highlightedText;
        // Attach click handlers to highlights
        const spans = state.highlightOverlay.querySelectorAll('.highlight-span');
        spans.forEach(span => {
            span.style.borderRadius = '2px';
            span.style.cursor = 'pointer';
            span.style.pointerEvents = 'auto';
            span.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const suggestionIndex = parseInt(span.getAttribute('data-suggestion-index'));
                const suggestion = state.currentSuggestions[suggestionIndex];
                this.showPopup(field, suggestion, e.clientX, e.clientY);
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showPopup(field, suggestion, x, y) {
        const state = this.fields[field];
        const messageDiv = state.popup.querySelector('.popup-message');
        const suggestionsDiv = state.popup.querySelector('.suggestions-list');
        
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
                item.onclick = () => this.applySuggestion(field, suggestion, replacement);
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
        state.popup.style.display = 'block';
        
        // Adjust position to stay within viewport
        const rect = state.popup.getBoundingClientRect();
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
        
        state.popup.style.left = adjustedX + 'px';
        state.popup.style.top = adjustedY + 'px';
        
        // Keep reference to current suggestion
        state.currentMention = suggestion;
        // Add extra blue button for spelling errors
        const ignoreBtn = state.popup.querySelector('.ignore-button');
        ignoreBtn.classList.add('popup-action-button');
        let blueBtn = state.popup.querySelector('.add-term-button');
        if (!blueBtn) {
            blueBtn = document.createElement('button');
            blueBtn.className = 'add-term-button popup-action-button';
            blueBtn.textContent = 'KLA Term';
        }
        // Only show the blue button for spelling errors (red highlight logic)
        if (suggestion.errorType === 'spelling') {
            ignoreBtn.insertAdjacentElement('afterend', blueBtn);
            blueBtn.onclick = () => {
                const text = state.editor.innerText.substring(suggestion.offset, suggestion.offset + suggestion.length);
                this.saveTerm(field, text);
                this.ignoreCurrentSuggestion(field);
                this.hidePopup(field);
                this.showStatus(field, `"${text}" added to KLA term bank`, 'success');
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
    }
    
    hidePopup(field) {
        const state = this.fields[field];
        state.popup.style.display = 'none';
        state.currentMention = null;
    }
    
    applySuggestion(field, suggestion, replacement) {
        const state = this.fields[field];
        // Save selection position and scroll position
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const scrollTop = state.editor.scrollTop;
        const scrollLeft = state.editor.scrollLeft;
        const text = state.editor.innerText;
        const before = text.substring(0, suggestion.offset);
        const after = text.substring(suggestion.offset + suggestion.length);
        state.editor.innerText = before + replacement + after;
        // Restore cursor position after replacement
        const newPosition = suggestion.offset + replacement.length;
        this.setCursorPosition(newPosition);
        // Restore scroll position
        state.editor.scrollTop = scrollTop;
        state.editor.scrollLeft = scrollLeft;
        // Remove the suggestion from currentSuggestions so highlight disappears immediately
        const newText = state.editor.innerText;
        const key = this.getSuggestionKey(suggestion, newText);
        state.currentSuggestions = state.currentSuggestions.filter(
            s => this.getSuggestionKey(s, newText) !== key
        );
        state.overlayHidden = true;
        state.awaitingCheck = true;
        this.updateHighlights(field);
        requestAnimationFrame(() => this.syncOverlayScroll(field)); // Ensure overlay is synced after browser updates scroll
        this.hidePopup(field);
        this.showStatus(field, 'Suggestion applied');
        state.editor.focus();
        this.debounceCheck(field);
    }
    
    showStatus(field, message, type = 'success', persist = false, removeLoading = false) {
        // Add support for a 'recording' type with icon
        let icon = '';
        if (type === 'recording') {
            icon = '<span style="display:inline-flex;align-items:center;margin-right:8px;"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="none" stroke="#fff" stroke-width="2"/><circle cx="10" cy="10" r="5" fill="#fff"/></svg></span>';
        }
        const state = this.fields[field];
        state.status.innerHTML = icon + message;
        state.status.className = `status show ${type}`;
        if (removeLoading) {
            state.status.classList.remove('loading');
        }
        // Clear any previous timer so only the latest message can clear the status
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        if (!persist) {
            this.statusTimer = setTimeout(() => {
                state.status.className = 'status';
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

    ignoreCurrentSuggestion(field) {
        const state = this.fields[field];
        if (state.currentMention) {
            const text = state.editor.innerText;
            const key = this.getSuggestionKey(state.currentMention, text);
            state.ignoredSuggestions.add(key);
            // Remove from currentSuggestions and update highlights
            state.currentSuggestions = state.currentSuggestions.filter(
                s => this.getSuggestionKey(s, text) !== key
            );
            this.updateHighlights(field);
        }
        this.hidePopup(field);
    }

    // Placeholder LLM call
    async submitToLLM(field, text, answers = null) {
        const state = this.fields[field];
        state.llmInProgress = true;
        if (answers) {
            this.showStatus(field, 'Rewriting...', 'checking', true); // persist loading message
        } else {
            this.showStatus(field, 'Reviewing...', 'checking', true); // persist loading message
        }
        state.status.classList.add('loading');
        try {
            let body = { text };
            if (answers) {
                body.answers = answers;
                body.step = 2;
            } else {
                body.step = 1;
            }
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            state.llmLastResult = data.result;
            this.displayLLMResult(data.result, answers !== null, true);
        } catch (e) {
            this.showStatus(field, 'LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            state.status.classList.remove('loading');
            state.llmInProgress = false;
        }
    }

    displayLLMResult(result, showRewrite, isActiveField) {
        const state = this.fields[this.activeField];
        // --- Render evaluation/score as a box above rewrite questions ---
        const evalBox = document.getElementById('llm-eval-box');
        let html = '';
        let valid = result && typeof result === 'object';
        let rulesObj = result && result.evaluation ? result.evaluation : result;
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        state.status.classList.remove('loading');
        state.status.className = 'status';
        state.status.textContent = '';
        state.llmInProgress = false;
        if (valid && rulesObj && typeof rulesObj === 'object') {
            // Calculate score
            const keys = Object.keys(rulesObj);
            const total = keys.length;
            const passed = keys.filter(key => rulesObj[key].passed).length;
            // Log evaluation to backend
            fetch('/llm-evaluation-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: state.editor.innerText,
                    score: `${passed}/${total}`,
                    criteria: keys.map(key => ({
                        name: key,
                        passed: !!rulesObj[key].passed
                    })),
                    timestamp: Date.now() / 1000
                })
            });
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
                    html += `
                        <div class="llm-section llm-dropdown" data-passed="true">
                            <div class="llm-section-header" tabindex="0">
                                <span class="llm-dropdown-arrow">&#9654;</span>
                                <span class="llm-section-title" style="color:#111;"><strong>${this.escapeHtml(key)}</strong></span>
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
            if (failedKeys.length > 0) {
                html += `<div style="font-weight:600;font-size:1.08em;color:#f44336;margin:18px 0 8px 0;">Needs Improvement</div>`;
                for (const key of failedKeys) {
                    const section = rulesObj[key];
                    html += `
                        <div class="llm-section llm-dropdown open" data-passed="false">
                            <div class="llm-section-header" tabindex="0">
                                <span class="llm-dropdown-arrow open">&#9660;</span>
                                <span class="llm-section-title" style="color:#111;"><strong>${this.escapeHtml(key)}</strong></span>
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
            evalBox.innerHTML = html;
            evalBox.style.display = 'flex';
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
        } else {
            evalBox.innerHTML = '';
            evalBox.style.display = 'none';
        }
        // ... existing code ...

        // --- Questions and rewrite popup logic ---
        const rewritePopup = document.getElementById('rewrite-popup');
        if (!showRewrite) {
            // Show questions for failed criteria
            state.llmQuestions = [];
            state.llmAnswers = {};
            if (rulesObj) {
                for (const key of Object.keys(rulesObj)) {
                    const section = rulesObj[key];
                    if (!section.passed && section.question) {
                        state.llmQuestions.push({ criteria: key, question: section.question });
                    }
                }
            }
            if (state.llmQuestions.length > 0) {
                let qHtml = '<div class="rewrite-title">To improve your input, please answer the following questions:</div>';
                state.llmQuestions.forEach((q, idx) => {
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
                                state.llmAnswers[crit] = el.value;
                            });
                            // Log rewrite submission
                            if (state.llmQuestions && state.llmQuestions.length > 0) {
                                const logArr = state.llmQuestions.map(q => ({
                                    original_text: state.editor.innerText,
                                    criteria: q.criteria,
                                    question: q.question,
                                    user_answer: state.llmAnswers[q.criteria] || ''
                                }));
                                fetch('/rewrite-feedback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(logArr)
                                });
                            }
                            // Resubmit to LLM with answers
                            this.submitToLLM(this.activeField, state.editor.innerText, state.llmAnswers);
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
                this.addToHistory(this.activeField, state.editor.innerText);
                // Replace the editor content with the rewrite
                state.editor.innerText = rewrite;
                // Hide overlay immediately to prevent flash of old highlights
                state.overlayHidden = true;
                this.updateHighlights(this.activeField);
                // Hide the rewrite popup and overlay
                rewritePopup.style.display = 'none';
                evalBox.style.display = 'none'; // Hide evaluation box as well
                // Update overlay for new text
                this.checkText(this.activeField);
                // Trigger a review (LLM evaluation) for the new text
                this.submitToLLM(this.activeField, rewrite);
            } else {
                rewritePopup.style.display = 'none';
            }
        }
        // ... existing code ...

        const feedbackBtns = evalBox.querySelectorAll('.llm-feedback-btn'); // Changed to evalBox
        feedbackBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const criteria = btn.getAttribute('data-criteria');
                const text = state.editor.innerText;
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
                        if (state.llmLastResult && state.llmLastResult.evaluation && state.llmLastResult.evaluation[criteria]) {
                            passed = state.llmLastResult.evaluation[criteria].passed;
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

    initMicButton(field) {
        const micBtn = document.getElementById(`mic-btn-${field}`);
        const state = this.fields[field];
        if (!micBtn) return;
        let isRecording = false;
        let mediaRecorder = null;
        let audioChunks = [];
        micBtn.addEventListener('click', async () => {
            if (!isRecording) {
                // Always clear editor and show status immediately
                state.editor.innerText = '';
                if (state.highlightOverlay) state.highlightOverlay.innerHTML = '';
                state.editor.setAttribute('data-placeholder', 'Listening...');
                state.editor.classList.add('empty');
                state.editor.setAttribute('contenteditable', 'false');
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
                        this.showStatus(field, 'Processing audio...', 'checking', true);
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
                                state.editor.innerText = data.transcription || '';
                                state.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                if (state.editor.innerText.trim() === '') {
                                    state.editor.classList.add('empty');
                                } else {
                                    state.editor.classList.remove('empty');
                                }
                                this.checkText(field);
                                this.llmPlaceholderCall(data.transcription || '');
                            } catch (e) {
                                state.editor.innerText = 'Error: Could not transcribe.';
                                this.showStatus(field, 'Transcription failed', 'error');
                                state.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                state.editor.classList.remove('empty');
                            }
                            micBtn.disabled = false;
                            state.editor.setAttribute('contenteditable', 'true');
                        }, 1000);
                    };
                    mediaRecorder.start();
                    isRecording = true;
                    micBtn.style.background = '#ffebee';
                    micBtn.style.color = '#d32f2f';
                    this.showStatus(field, 'Listening...', 'recording', true);
                } catch (err) {
                    state.editor.innerText = '';
                    state.editor.setAttribute('contenteditable', 'true');
                    this.showStatus(field, 'Could not access microphone.', 'error');
                    alert('Could not access microphone.');
                    state.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                    state.editor.classList.add('empty');
                }
            } else {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    isRecording = false;
                }
            }
        });
    }

    syncOverlayScroll(field) {
        const state = this.fields[field];
        if (state.highlightOverlay && state.editor) {
            state.highlightOverlay.scrollTop = state.editor.scrollTop;
            state.highlightOverlay.scrollLeft = state.editor.scrollLeft;
        }
    }

    // --- Placeholder for LLM call after transcription ---
    llmPlaceholderCall(transcription) {
        if (!transcription || transcription.trim() === '') return;
        // TODO: Replace this with your actual LLM call logic
        console.log('LLM placeholder: would process transcription:', transcription);
        // Example: this.submitToLLM(transcription);
    }

    saveTerm(field, term) {
        // Send the term to the backend
        fetch('/terms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term })
        })
        .then(res => {
            if (!res.ok) throw new Error('Failed to add term');
            // No need to check for data.terms anymore
        })
        .catch(() => {
            this.showStatus(field, 'Failed to add term', 'error');
        });
    }

    addToHistory(field, text) {
        if (!text || !text.trim()) return;
        const state = this.fields[field];
        state.history.unshift(text);
        if (state.history.length > 50) state.history = state.history.slice(0, 50);
        this.renderHistory();
    }

    renderHistory() {
        const state = this.fields[this.activeField];
        if (!state.historyList) return;
        state.historyList.innerHTML = '';
        state.history.forEach((item, idx) => {
            const li = document.createElement('li');
            li.textContent = item.length > 120 ? item.slice(0, 117) + '...' : item;
            li.title = item;
            // Add history icon for restore
            const icon = document.createElement('span');
            icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 512 512" fill="#41007F" style="display:inline-block;vertical-align:middle;"><path d="M256 64C150 64 64 150 64 256H16l80 96 80-96h-48c0-88.2 71.8-160 160-160s160 71.8 160 160-71.8 160-160 160c-39.7 0-76.1-14.3-104.2-37.9-6.9-5.7-17.1-4.7-22.8 2.2s-4.7 17.1 2.2 22.8C163.7 426.2 207.6 448 256 448c106 0 192-86 192-192S362 64 256 64z"/></svg>';
            icon.style.float = 'right';
            icon.style.cursor = 'pointer';
            icon.style.marginLeft = '12px';
            icon.style.display = 'inline-flex';
            icon.style.alignItems = 'center';
            icon.title = 'Restore to editor';
            icon.onclick = (e) => {
                e.stopPropagation();
                state.editor.innerText = item;
            };
            li.appendChild(icon);
            // Remove item click/hover highlight
            li.style.cursor = 'default';
            li.onmouseenter = null;
            li.onmouseleave = null;
            li.onclick = null;
            state.historyList.appendChild(li);
        });
    }
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LanguageToolEditor();
});