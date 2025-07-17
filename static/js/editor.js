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
        this.llmQuestions = []; // Store questions for failed criteria
        this.llmAnswers = {};   // Store user answers
        this.llmStep = 0;      // 0: evaluation/questions, 1: rewrite
        
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
                // If questions are being shown, collect answers and submit for rewrite
                if (this.llmStep === 1) {
                    this.collectLLMAnswersAndSubmit(text);
                } else {
                    this.submitToLLM(text);
                }
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
            const category = suggestion.category ? suggestion.category.toLowerCase() : '';
            let categoryClass = '';
            if (category === 'typos' || category === 'compounding') {
                categoryClass = 'highlight-span-spelling';
            } else if (category === 'grammar') {
                categoryClass = 'highlight-span-grammar';
            } else if (category) {
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

    // --- LLM Step 1: Evaluation and Questions ---
    async submitToLLM(text) {
        this.llmInProgress = true;
        this.showStatus('Reviewing...', 'checking', true); // persist loading message
        this.status.classList.add('loading');
        try {
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, step: 1 })
            });
            const data = await response.json();
            this.displayLLMQuestions(data.result);
        } catch (e) {
            this.showStatus('LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            this.status.classList.remove('loading');
            this.llmInProgress = false;
        }
    }

    // --- LLM Step 2: Rewrite after answers ---
    async collectLLMAnswersAndSubmit(text) {
        // Collect answers from UI
        const answers = {};
        this.llmQuestions.forEach((q, idx) => {
            const input = document.getElementById(`llm-answer-${idx}`);
            answers[q.criterion] = input ? input.value : '';
        });
        this.llmAnswers = answers;
        this.llmInProgress = true;
        this.showStatus('Generating rewrite...', 'checking', true);
        this.status.classList.add('loading');
        try {
            const response = await fetch('/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, step: 2, answers })
            });
            const data = await response.json();
            this.displayLLMRewrite(data.result);
        } catch (e) {
            this.showStatus('LLM call failed', 'error');
            alert('LLM call failed: ' + e);
            this.status.classList.remove('loading');
            this.llmInProgress = false;
        }
    }

    // --- Display LLM Questions UI ---
    displayLLMQuestions(result) {
        this.llmStep = 1;
        this.llmQuestions = [];
        // Parse failed criteria and questions
        let rulesObj = result && result.evaluation ? result.evaluation : result;
        const questions = [];
        for (const key in rulesObj) {
            const section = rulesObj[key];
            if (section.passed === false && section.question) {
                questions.push({ criterion: key, question: section.question });
            }
        }
        this.llmQuestions = questions;
        // Render questions below the input box (rewrite-popup area)
        const rewritePopup = document.getElementById('rewrite-popup');
        let html = '';
        if (questions.length > 0) {
            html += `<div class="rewrite-title">To improve your input, please answer the following questions:</div>`;
            questions.forEach((q, idx) => {
                html += `<div class="rewrite-content"><strong>${this.escapeHtml(q.criterion)}:</strong> ${this.escapeHtml(q.question)}<br/><textarea id="llm-answer-${idx}" rows="2" style="width:98%;margin-top:6px;"></textarea></div>`;
            });
            html += `<button id="llm-questions-submit" class="llm-submit-button" style="margin-top:18px;">Submit Answers</button>`;
        } else {
            html += `<div class="rewrite-title">No improvement questions generated. Your input may already be strong!</div>`;
        }
        rewritePopup.innerHTML = html;
        rewritePopup.style.display = 'block';
        // Add event for the submit button
        const submitBtn = document.getElementById('llm-questions-submit');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                document.getElementById('llm-submit').click();
            });
        }
        // Hide LLM result overlay (no rewrite yet)
        const overlay = document.getElementById('llm-result-overlay');
        overlay.style.display = 'none';
        // Remove loading spinner
        this.status.classList.remove('loading');
        this.llmInProgress = false;
    }

    // --- Display LLM Rewrite UI ---
    displayLLMRewrite(result) {
        this.llmStep = 0;
        // Show the rewrite in the rewrite-popup area
        const rewritePopup = document.getElementById('rewrite-popup');
        let rewrite = '';
        if (result && typeof result === 'object') {
            if (result.rewritten_problem_statement) {
                rewrite = result.rewritten_problem_statement;
            } else if (result.rewrite) {
                rewrite = result.rewrite;
            } else if (typeof result === 'string') {
                rewrite = result;
            }
        } else if (typeof result === 'string') {
            rewrite = result;
        }
        rewritePopup.innerHTML = `<div class="rewrite-title">Suggested Rewrite</div><div class="rewrite-content">${this.escapeHtml(rewrite)}</div>`;
        rewritePopup.style.display = 'block';
        // Hide LLM result overlay
        const overlay = document.getElementById('llm-result-overlay');
        overlay.style.display = 'none';
        // Remove loading spinner
        this.status.classList.remove('loading');
        this.llmInProgress = false;
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
}

// Initialize the editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LanguageToolEditor();
});