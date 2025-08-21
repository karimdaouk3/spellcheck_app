# Text-to-Speech Converter

A simple, modern web application that converts text to speech and provides downloadable WAV files.

## Features

- 🎤 **Text Input**: Clean, responsive text area for entering content
- 🔊 **Audio Generation**: Convert text to speech with placeholder audio (sine wave)
- 🎵 **Audio Playback**: Built-in audio player for immediate listening
- 💾 **Download**: Download generated audio as WAV files
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices
- 🎨 **Modern UI**: Beautiful gradient design with smooth animations

## Setup

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Application**:
   ```bash
   python app.py
   ```

3. **Access the App**:
   Open your browser and go to `http://localhost:5001`

## Usage

1. **Enter Text**: Type or paste your text in the input area
2. **Generate Speech**: Click "Generate Speech" or press `Ctrl+Enter`
3. **Listen**: Use the built-in audio player to preview
4. **Download**: Click "Download WAV" to save the audio file

## API Endpoint

The app includes a REST API for programmatic access:

**POST** `/api/tts`

**Request Body**:
```json
{
  "text": "Your text to convert to speech"
}
```

**Response**:
```json
{
  "success": true,
  "audio_base64": "base64_encoded_wav_file",
  "text": "Your text to convert to speech",
  "duration": 2.0
}
```

## Technical Details

- **Backend**: Flask (Python)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Audio Format**: WAV (16-bit, 22.05kHz, mono)
- **Placeholder Audio**: 440Hz sine wave (A4 note)

## File Structure

```
tts_app/
├── app.py              # Flask application
├── requirements.txt    # Python dependencies
├── README.md          # This file
├── templates/
│   └── index.html     # Main HTML template
└── static/
    ├── css/
    │   └── style.css  # Stylesheets
    └── js/
        └── app.js     # JavaScript functionality
```

## Customization

### Adding Real TTS Model

To integrate a real text-to-speech model, replace the placeholder audio generation in `app.py`:

```python
# Replace this section in the /api/tts endpoint:
# Generate placeholder audio (sine wave)

# With your TTS model call:
# audio_data = your_tts_model.generate_speech(text)
```

### Styling

The app uses a consistent color scheme that can be customized in `static/css/style.css`:

- Primary: `#667eea` (Blue)
- Secondary: `#764ba2` (Purple)
- Success: `#48bb78` (Green)
- Error: `#c53030` (Red)

## License

This project is for internal use at KLA Corporation.
