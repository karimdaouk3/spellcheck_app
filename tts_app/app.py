from flask import Flask, render_template, request, jsonify, send_file
import os
import tempfile
import base64
import io
import wave
import numpy as np

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/tts', methods=['POST'])
def text_to_speech():
    """
    Text-to-speech API endpoint
    Input: {"text": "text to convert to speech"}
    Output: Base64 encoded WAV file
    """
    try:
        data = request.get_json()
        
        if not data or "text" not in data:
            return jsonify({"error": "Missing required field: text"}), 400
        
        text = data["text"].strip()
        
        if not text:
            return jsonify({"error": "Text cannot be empty"}), 400
        
        # Generate placeholder audio (sine wave)
        # In a real implementation, this would call a TTS model
        sample_rate = 22050
        duration = 2.0  # 2 seconds
        frequency = 440  # A4 note
        
        # Generate sine wave
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        audio_data = np.sin(2 * np.pi * frequency * t) * 0.3
        
        # Convert to 16-bit PCM
        audio_data = (audio_data * 32767).astype(np.int16)
        
        # Create WAV file in memory
        with io.BytesIO() as wav_buffer:
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(audio_data.tobytes())
            
            wav_buffer.seek(0)
            audio_base64 = base64.b64encode(wav_buffer.read()).decode('utf-8')
        
        return jsonify({
            "success": True,
            "audio_base64": audio_base64,
            "text": text,
            "duration": duration
        })
        
    except Exception as e:
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5001)
