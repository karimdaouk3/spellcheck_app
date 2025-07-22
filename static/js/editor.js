class LanguageToolEditor {
    constructor() {
        this.debounceTimer = null;
        this.currentSuggestions = [];
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
        this.historyPanel = document.getElementById('history-panel');
        this.historyList = document.getElementById('history-list');
        this.toggleHistoryBtn = document.getElementById('toggle-history');
        this.openHistoryBtn = document.getElementById('open-history-btn');
        this.historyMenuIcon = document.getElementById('history-menu-icon');
        this.historyCloseIcon = document.getElementById('history-close-icon');
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
        this.highlightOverlay.style.fontFamily = this.editor.style.fontFamily || 'inherit';
        this.highlightOverlay.style.fontSize = this.editor.style.fontSize || '16px';
        this.highlightOverlay.style.lineHeight = this.editor.style.lineHeight || '1.5';
        this.highlightOverlay.style.padding = '15px';
        this.highlightOverlay.style.boxSizing = 'border-box';
        this.highlightOverlay.style.whiteSpace = 'pre-wrap';
        this.highlightOverlay.style.wordBreak = 'break-word';
        this.highlightOverlay.style.background = 'transparent';
        this.editor.parentElement.appendChild(this.highlightOverlay);
        this.editor.parentElement.style.position = 'relative';
        // Always scroll overlay to top when created
        this.highlightOverlay.scrollTop = 0;
    }
    
    initEventListeners() {
        // Input event for checking text
        this.editor.addEventListener('input', () => {
            if (!this.overlayHidden) {
                this.updateHighlights(); // Only update overlay if not hidden
            }
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
                if (text.replace(/\s/g, '').length < 20) {
                    alert('Please make sure your problem statement is meaningful and comprehensive (at least 20 characters)');
                    return;
                }
                this.submitToLLM(text); // Only text on first submit
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
                    // Always clear editor and show status immediately
                    this.editor.innerText = '';
                    this.highlightOverlay.innerHTML = '';
                    // Set placeholder to 'Listening...'
                    this.editor.setAttribute('data-placeholder', 'Listening...');
                    this.editor.classList.add('empty');
                    this.editor.setAttribute('contenteditable', 'false');
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        // Try to use 'audio/wav' for MediaRecorder if supported
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
                            // Combine audio chunks
                            let audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                            // If not wav, try to convert to wav (placeholder)
                            if (audioBlob.type !== 'audio/wav') {
                                // Placeholder: conversion to wav (requires external library or server-side)
                                // For now, just use the original blob
                                // TODO: Implement client-side wav conversion if needed
                            }
                            // Save audio file locally (optional, placeholder)
                            // Example: download the audio as .wav
                            // const url = URL.createObjectURL(audioBlob);
                            // const a = document.createElement('a');
                            // a.style.display = 'none';
                            // a.href = url;
                            // a.download = 'recording.wav';
                            // document.body.appendChild(a);
                            // a.click();
                            // setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
                            // Send audio to backend
                            const formData = new FormData();
                            formData.append('audio', audioBlob, 'recording.wav');
                            setTimeout(async () => {
                                try {
                                    const response = await fetch('/speech-to-text', {
                                        method: 'POST',
                                        body: formData
                                    });
                                    const data = await response.json();
                                    this.editor.innerText = data.transcription || '';
                                    // Restore placeholder
                                    this.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                    if (this.editor.innerText.trim() === '') {
                                        this.editor.classList.add('empty');
                                    } else {
                                        this.editor.classList.remove('empty');
                                    }
                                    this.checkText();
                                    // --- Placeholder: Call LLM with transcription ---
                                    // Replace this with your actual LLM call logic
                                    this.llmPlaceholderCall(data.transcription || '');
                                } catch (e) {
                                    this.editor.innerText = 'Error: Could not transcribe.';
                                    this.showStatus('Transcription failed', 'error');
                                    this.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                    this.editor.classList.remove('empty');
                                }
                                micBtn.disabled = false;
                                this.editor.setAttribute('contenteditable', 'true');
                            }, 1000);
                        };
                        mediaRecorder.start();
                        isRecording = true;
                        micBtn.style.background = '#ffebee';
                        micBtn.style.color = '#d32f2f';
                        // Only show 'Listening...' alert with icon
                        this.showStatus('Listening...', 'recording', true); // red with icon
                    } catch (err) {
                        this.editor.innerText = '';
                        this.editor.setAttribute('contenteditable', 'true');
                        this.showStatus('Could not access microphone.', 'error');
                        alert('Could not access microphone.');
                        // Restore placeholder
                        this.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                        this.editor.classList.add('empty');
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

        // Accept Rewrite check and dismiss (X) events
        const acceptRewriteCheck = document.getElementById('accept-rewrite-check');
        const dismissRewriteX = document.getElementById('dismiss-rewrite-x');
        const rewritePopup = document.getElementById('rewrite-popup');
        if (acceptRewriteCheck) {
            acceptRewriteCheck.addEventListener('click', () => {
                const rewriteContent = rewritePopup.querySelector('.rewrite-content').textContent;
                this.editor.innerText = rewriteContent;
                this.awaitingCheck = true;
                this.overlayHidden = true;
                this.highlightOverlay.innerHTML = '';
                rewritePopup.style.display = 'none';
                // Wait for DOM update before running checkText
                requestAnimationFrame(() => {
                    this.checkText();
                });
            });
        }
        if (dismissRewriteX) {
            dismissRewriteX.addEventListener('click', () => {
                rewritePopup.style.display = 'none';
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
            this.awaitingCheck = false;
            this.overlayHidden = false;
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
        if (this.awaitingCheck || this.overlayHidden) {
            this.highlightOverlay.innerHTML = '';
            // Scroll overlay and editor to top only when it is shown (even if empty)
            this.highlightOverlay.scrollTop = 0;
            this.editor.scrollTop = 0;
            return;
        }
        const text = this.editor.innerText;
        if (this.currentSuggestions.length === 0) {
            this.highlightOverlay.innerHTML = '';
            // Scroll overlay and editor to top after DOM update
            requestAnimationFrame(() => {
                this.highlightOverlay.scrollTop = 0;
                this.editor.scrollTop = 0;
            });
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
        this.highlightOverlay.innerHTML = highlightedText;
        // Scroll overlay and editor to top after DOM update
        requestAnimationFrame(() => {
            this.highlightOverlay.scrollTop = 0;
            this.editor.scrollTop = 0;
        });
        // Attach click handlers to highlights
        const spans = this.highlightOverlay.querySelectorAll('.highlight-span');
        spans.forEach(span => {
            span.style.borderRadius = '2px';
            span.style.cursor = 'pointer';
            span.style.pointerEvents = 'auto';
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
                const text = this.editor.innerText.substring(suggestion.offset, suggestion.offset + suggestion.length);
                this.saveTerm(text);
                this.ignoreCurrentSuggestion();
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
        this.overlayHidden = true;
        this.awaitingCheck = true;
        this.updateHighlights();
        requestAnimationFrame(() => this.syncOverlayScroll()); // Ensure overlay is synced after browser updates scroll
        this.hidePopup();
        this.showStatus('Suggestion applied');
        this.editor.focus();
        this.debounceCheck();
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
    async submitToLLM(text, answers = null) {
        this.llmInProgress = true;
        if (answers) {
            this.showStatus('Rewriting...', 'checking', true); // persist loading message
        } else {
            this.showStatus('Reviewing...', 'checking', true); // persist loading message
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
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            this.llmLastResult = data.result;
            this.displayLLMResult(data.result, answers !== null);
        } catch (e) {
            this.showStatus('LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            this.status.classList.remove('loading');
            this.llmInProgress = false;
        }
    }

    displayLLMResult(result, showRewrite) {
        // --- Render evaluation/score as a box above rewrite questions ---
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
        this.llmInProgress = false;
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
                    text: this.editor.innerText,
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
            this.llmQuestions = [];
            this.llmAnswers = {};
            if (rulesObj) {
                for (const key of Object.keys(rulesObj)) {
                    const section = rulesObj[key];
                    if (!section.passed && section.question) {
                        this.llmQuestions.push({ criteria: key, question: section.question });
                    }
                }
            }
            if (this.llmQuestions.length > 0) {
                let qHtml = '<div class="rewrite-title">To improve your input, please answer the following questions:</div>';
                this.llmQuestions.forEach((q, idx) => {
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
                                this.llmAnswers[crit] = el.value;
                            });
                            // Log rewrite submission
                            if (this.llmQuestions && this.llmQuestions.length > 0) {
                                const logArr = this.llmQuestions.map(q => ({
                                    original_text: this.editor.innerText,
                                    criteria: q.criteria,
                                    question: q.question,
                                    user_answer: this.llmAnswers[q.criteria] || ''
                                }));
                                fetch('/rewrite-feedback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(logArr)
                                });
                            }
                            // Resubmit to LLM with answers
                            this.submitToLLM(this.editor.innerText, this.llmAnswers);
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
                this.addToHistory(this.editor.innerText);
                // Replace the editor content with the rewrite
                this.editor.innerText = rewrite;
                // Hide overlay immediately to prevent flash of old highlights
                this.overlayHidden = true;
                this.highlightOverlay.innerHTML = '';
                // Hide the rewrite popup and overlay
                rewritePopup.style.display = 'none';
                evalBox.style.display = 'none'; // Hide evaluation box as well
                // Update overlay for new text
                this.checkText();
                // Trigger a review (LLM evaluation) for the new text
                this.submitToLLM(rewrite);
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
                const text = this.editor.innerText;
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
                        if (this.llmLastResult && this.llmLastResult.evaluation && this.llmLastResult.evaluation[criteria]) {
                            passed = this.llmLastResult.evaluation[criteria].passed;
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

    syncOverlayScroll() {
        if (this.highlightOverlay && this.editor) {
            this.highlightOverlay.scrollTop = this.editor.scrollTop;
            this.highlightOverlay.scrollLeft = this.editor.scrollLeft;
        }
    }

    // --- Placeholder for LLM call after transcription ---
    llmPlaceholderCall(transcription) {
        if (!transcription || transcription.trim() === '') return;
        // TODO: Replace this with your actual LLM call logic
        console.log('LLM placeholder: would process transcription:', transcription);
        // Example: this.submitToLLM(transcription);
    }

    saveTerm(term) {
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
            this.showStatus('Failed to add term', 'error');
        });
    }

    addToHistory(text) {
        if (!text || !text.trim()) return;
        this.history.unshift(text);
        if (this.history.length > 50) this.history = this.history.slice(0, 50);
        this.renderHistory();
    }

    renderHistory() {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';
        this.history.forEach((item, idx) => {
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
                this.editor.innerText = item;
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
}

// Refactored: Support two independent editors (problem and fsr)
class MultiFieldEditor {
    constructor() {
        this.fields = {
            problem: this.createField('problem'),
            fsr: this.createField('fsr')
        };
        this.activeField = 'problem';
        this.initFieldEvents('problem');
        this.initFieldEvents('fsr');
        this.switchToField('problem');
    }

    createField(field) {
        return {
            editor: document.getElementById(`editor-${field}`),
            micBtn: document.getElementById(`mic-btn-${field}`),
            micIcon: document.getElementById(`mic-icon-${field}`),
            submitBtn: document.getElementById(`llm-submit-${field}`),
            text: '',
            history: [],
            evaluation: null,
            rewrite: null,
            highlightOverlay: null,
            debounceTimer: null,
            currentSuggestions: [],
            ignoredSuggestions: new Set(),
            llmInProgress: false,
            overlayHidden: false,
            awaitingCheck: false,
            llmQuestions: [],
            llmAnswers: {},
            llmLastResult: null
        };
    }

    initFieldEvents(field) {
        const f = this.fields[field];
        // Focus event to switch active field
        f.editor.addEventListener('focus', () => this.switchToField(field));
        // Input event for spellcheck
        f.editor.addEventListener('input', () => {
            if (!f.overlayHidden) {
                this.updateHighlights(field);
            }
            this.debounceCheck(field);
        });
        // Mic button
        f.micBtn.addEventListener('click', () => this.handleMic(field));
        // Submit button
        f.submitBtn.addEventListener('click', () => this.submitToLLM(field));
        // Spellcheck on load if text exists
        if (f.editor.innerText.trim()) {
            this.checkText(field);
        }
    }

    switchToField(field) {
        this.activeField = field;
        // Update UI: show correct history, evaluation, rewrite, etc.
        this.renderHistory(field);
        this.renderEvaluation(field);
        this.renderRewrite(field);
    }

    debounceCheck(field) {
        const f = this.fields[field];
        clearTimeout(f.debounceTimer);
        f.debounceTimer = setTimeout(() => {
            this.checkText(field);
        }, 1000);
    }

    async checkText(field) {
        const f = this.fields[field];
        const text = f.editor.innerText;
        if (!text.trim()) {
            this.clearSuggestions(field);
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
                s => !f.ignoredSuggestions.has(this.getSuggestionKey(s, text))
            );
            f.currentSuggestions = suggestions;
            f.awaitingCheck = false;
            f.overlayHidden = false;
            this.updateHighlights(field);
        } catch (error) {
            // Optionally show error
        }
    }

    clearSuggestions(field) {
        const f = this.fields[field];
        f.currentSuggestions = [];
        this.updateHighlights(field);
    }

    updateHighlights(field) {
        const f = this.fields[field];
        if (f.awaitingCheck || f.overlayHidden) {
            f.highlightOverlay.innerHTML = '';
            // Scroll overlay and editor to top only when it is shown (even if empty)
            f.highlightOverlay.scrollTop = 0;
            f.editor.scrollTop = 0;
            return;
        }
        const text = f.editor.innerText;
        if (f.currentSuggestions.length === 0) {
            f.highlightOverlay.innerHTML = '';
            // Scroll overlay and editor to top after DOM update
            requestAnimationFrame(() => {
                f.highlightOverlay.scrollTop = 0;
                f.editor.scrollTop = 0;
            });
            return;
        }
        // Create highlighted text
        let highlightedText = '';
        let lastIndex = 0;
        f.currentSuggestions.forEach((suggestion, index) => {
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
        f.highlightOverlay.innerHTML = highlightedText;
        // Scroll overlay and editor to top after DOM update
        requestAnimationFrame(() => {
            f.highlightOverlay.scrollTop = 0;
            f.editor.scrollTop = 0;
        });
        // Attach click handlers to highlights
        const spans = f.highlightOverlay.querySelectorAll('.highlight-span');
        spans.forEach(span => {
            span.style.borderRadius = '2px';
            span.style.cursor = 'pointer';
            span.style.pointerEvents = 'auto';
            span.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const suggestionIndex = parseInt(span.getAttribute('data-suggestion-index'));
                const suggestion = f.currentSuggestions[suggestionIndex];
                this.showPopup(suggestion, e.clientX, e.clientY);
            });
        });
    }

    handleMic(field) {
        const f = this.fields[field];
        let isRecording = false;
        let mediaRecorder = null;
        let audioChunks = [];
        if (f.micBtn) {
            f.micBtn.addEventListener('click', async () => {
                if (!isRecording) {
                    // Always clear editor and show status immediately
                    f.editor.innerText = '';
                    f.highlightOverlay.innerHTML = '';
                    // Set placeholder to 'Listening...'
                    f.editor.setAttribute('data-placeholder', 'Listening...');
                    f.editor.classList.add('empty');
                    f.editor.setAttribute('contenteditable', 'false');
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        // Try to use 'audio/wav' for MediaRecorder if supported
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
                            f.micBtn.style.background = '';
                            f.micBtn.style.color = '';
                            f.micBtn.disabled = true;
                            this.showStatus('Processing audio...', 'checking', true);
                            // Combine audio chunks
                            let audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                            // If not wav, try to convert to wav (placeholder)
                            if (audioBlob.type !== 'audio/wav') {
                                // Placeholder: conversion to wav (requires external library or server-side)
                                // For now, just use the original blob
                                // TODO: Implement client-side wav conversion if needed
                            }
                            // Save audio file locally (optional, placeholder)
                            // Example: download the audio as .wav
                            // const url = URL.createObjectURL(audioBlob);
                            // const a = document.createElement('a');
                            // a.style.display = 'none';
                            // a.href = url;
                            // a.download = 'recording.wav';
                            // document.body.appendChild(a);
                            // a.click();
                            // setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
                            // Send audio to backend
                            const formData = new FormData();
                            formData.append('audio', audioBlob, 'recording.wav');
                            setTimeout(async () => {
                                try {
                                    const response = await fetch('/speech-to-text', {
                                        method: 'POST',
                                        body: formData
                                    });
                                    const data = await response.json();
                                    f.editor.innerText = data.transcription || '';
                                    // Restore placeholder
                                    f.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                    if (f.editor.innerText.trim() === '') {
                                        f.editor.classList.add('empty');
                                    } else {
                                        f.editor.classList.remove('empty');
                                    }
                                    this.checkText(field);
                                    // --- Placeholder: Call LLM with transcription ---
                                    // Replace this with your actual LLM call logic
                                    this.llmPlaceholderCall(data.transcription || '');
                                } catch (e) {
                                    f.editor.innerText = 'Error: Could not transcribe.';
                                    this.showStatus('Transcription failed', 'error');
                                    f.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                                    f.editor.classList.remove('empty');
                                }
                                f.micBtn.disabled = false;
                                f.editor.setAttribute('contenteditable', 'true');
                            }, 1000);
                        };
                        mediaRecorder.start();
                        isRecording = true;
                        f.micBtn.style.background = '#ffebee';
                        f.micBtn.style.color = '#d32f2f';
                        // Only show 'Listening...' alert with icon
                        this.showStatus('Listening...', 'recording', true); // red with icon
                    } catch (err) {
                        f.editor.innerText = '';
                        f.editor.setAttribute('contenteditable', 'true');
                        this.showStatus('Could not access microphone.', 'error');
                        alert('Could not access microphone.');
                        // Restore placeholder
                        f.editor.setAttribute('data-placeholder', 'Start typing your text here...');
                        f.editor.classList.add('empty');
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

    async submitToLLM(field) {
        const f = this.fields[field];
        const text = f.editor.innerText;
        if (text.replace(/\s/g, '').length < 20) {
            alert('Please make sure your problem statement is meaningful and comprehensive (at least 20 characters)');
            return;
        }
        this.llmInProgress = true;
        this.showStatus('Reviewing...', 'checking', true);
        this.status.classList.add('loading');
        try {
            let body = { text };
            if (f.llmAnswers && Object.keys(f.llmAnswers).length > 0) {
                body.answers = f.llmAnswers;
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
            f.llmLastResult = data.result;
            this.displayLLMResult(data.result, f.llmAnswers !== null);
        } catch (e) {
            this.showStatus('LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            this.status.classList.remove('loading');
            this.llmInProgress = false;
        }
    }

    async displayLLMResult(result, showRewrite) {
        // --- Render evaluation/score as a box above rewrite questions ---
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
        this.llmInProgress = false;
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
                    text: this.editor.innerText,
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
            this.llmQuestions = [];
            this.llmAnswers = {};
            if (rulesObj) {
                for (const key of Object.keys(rulesObj)) {
                    const section = rulesObj[key];
                    if (!section.passed && section.question) {
                        this.llmQuestions.push({ criteria: key, question: section.question });
                    }
                }
            }
            if (this.llmQuestions.length > 0) {
                let qHtml = '<div class="rewrite-title">To improve your input, please answer the following questions:</div>';
                this.llmQuestions.forEach((q, idx) => {
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
                                this.llmAnswers[crit] = el.value;
                            });
                            // Log rewrite submission
                            if (this.llmQuestions && this.llmQuestions.length > 0) {
                                const logArr = this.llmQuestions.map(q => ({
                                    original_text: this.editor.innerText,
                                    criteria: q.criteria,
                                    question: q.question,
                                    user_answer: this.llmAnswers[q.criteria] || ''
                                }));
                                fetch('/rewrite-feedback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(logArr)
                                });
                            }
                            // Resubmit to LLM with answers
                            this.submitToLLM(this.editor.innerText, this.llmAnswers);
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
                this.addToHistory(this.editor.innerText);
                // Replace the editor content with the rewrite
                this.editor.innerText = rewrite;
                // Hide overlay immediately to prevent flash of old highlights
                this.overlayHidden = true;
                this.highlightOverlay.innerHTML = '';
                // Hide the rewrite popup and overlay
                rewritePopup.style.display = 'none';
                evalBox.style.display = 'none'; // Hide evaluation box as well
                // Update overlay for new text
                this.checkText();
                // Trigger a review (LLM evaluation) for the new text
                this.submitToLLM(rewrite);
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
                const text = this.editor.innerText;
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
                        if (this.llmLastResult && this.llmLastResult.evaluation && this.llmLastResult.evaluation[criteria]) {
                            passed = this.llmLastResult.evaluation[criteria].passed;
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

    syncOverlayScroll() {
        if (this.highlightOverlay && this.editor) {
            this.highlightOverlay.scrollTop = this.editor.scrollTop;
            this.highlightOverlay.scrollLeft = this.editor.scrollLeft;
        }
    }

    // --- Placeholder for LLM call after transcription ---
    llmPlaceholderCall(transcription) {
        if (!transcription || transcription.trim() === '') return;
        // TODO: Replace this with your actual LLM call logic
        console.log('LLM placeholder: would process transcription:', transcription);
        // Example: this.submitToLLM(transcription);
    }

    saveTerm(term) {
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
            this.showStatus('Failed to add term', 'error');
        });
    }

    addToHistory(text) {
        if (!text || !text.trim()) return;
        this.history.unshift(text);
        if (this.history.length > 50) this.history = this.history.slice(0, 50);
        this.renderHistory();
    }

    renderHistory() {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';
        this.history.forEach((item, idx) => {
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
                this.editor.innerText = item;
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
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MultiFieldEditor();
});