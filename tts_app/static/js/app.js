class TTSApp {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.currentAudio = null;
    }

    initializeElements() {
        // Input elements
        this.textInput = document.getElementById('text-input');
        this.charCount = document.getElementById('char-count');
        this.clearBtn = document.getElementById('clear-btn');
        
        // Generate elements
        this.generateBtn = document.getElementById('generate-btn');
        this.loading = document.getElementById('loading');
        
        // Output elements
        this.outputSection = document.getElementById('output-section');
        this.audioPlayer = document.getElementById('audio-player');
        this.downloadBtn = document.getElementById('download-btn');
        
        // Error elements
        this.errorSection = document.getElementById('error-section');
        this.errorText = document.getElementById('error-text');
    }

    bindEvents() {
        // Text input events
        this.textInput.addEventListener('input', () => this.updateCharCount());
        this.textInput.addEventListener('keydown', (e) => this.handleKeydown(e));
        
        // Button events
        this.clearBtn.addEventListener('click', () => this.clearText());
        this.generateBtn.addEventListener('click', () => this.generateSpeech());
        this.downloadBtn.addEventListener('click', () => this.downloadAudio());
        
        // Initialize character count
        this.updateCharCount();
    }

    updateCharCount() {
        const count = this.textInput.value.length;
        this.charCount.textContent = count;
        
        // Update generate button state
        this.generateBtn.disabled = count === 0;
    }

    handleKeydown(e) {
        // Allow Ctrl+Enter to generate speech
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            this.generateSpeech();
        }
    }

    clearText() {
        this.textInput.value = '';
        this.updateCharCount();
        this.hideOutput();
        this.hideError();
    }

    async generateSpeech() {
        const text = this.textInput.value.trim();
        
        if (!text) {
            this.showError('Please enter some text to convert to speech.');
            return;
        }

        this.showLoading();
        this.hideOutput();
        this.hideError();

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate speech');
            }

            if (data.success) {
                this.displayAudio(data.audio_base64, data.text);
            } else {
                throw new Error('Failed to generate speech');
            }

        } catch (error) {
            console.error('TTS Error:', error);
            this.showError(error.message || 'An error occurred while generating speech.');
        } finally {
            this.hideLoading();
        }
    }

    displayAudio(audioBase64, text) {
        // Convert base64 to blob
        const audioBlob = this.base64ToBlob(audioBase64, 'audio/wav');
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Set audio source
        this.audioPlayer.src = audioUrl;
        
        // Store current audio for download
        this.currentAudio = {
            blob: audioBlob,
            url: audioUrl,
            text: text
        };
        
        // Show output section
        this.outputSection.classList.remove('hidden');
        
        // Scroll to output
        this.outputSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    downloadAudio() {
        if (!this.currentAudio) {
            this.showError('No audio available for download.');
            return;
        }

        // Create download link
        const link = document.createElement('a');
        link.href = this.currentAudio.url;
        
        // Generate filename from text
        const filename = this.generateFilename(this.currentAudio.text);
        link.download = filename;
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    generateFilename(text) {
        // Clean text for filename
        const cleanText = text
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 30);
        
        return `tts_${cleanText}.wav`;
    }

    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    showLoading() {
        this.loading.classList.remove('hidden');
        this.generateBtn.disabled = true;
    }

    hideLoading() {
        this.loading.classList.add('hidden');
        this.generateBtn.disabled = false;
    }

    showError(message) {
        this.errorText.textContent = message;
        this.errorSection.classList.remove('hidden');
        this.errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    hideError() {
        this.errorSection.classList.add('hidden');
    }

    hideOutput() {
        this.outputSection.classList.add('hidden');
        this.currentAudio = null;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TTSApp();
});
