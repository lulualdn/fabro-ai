# Fabro voice server: speech-to-text (faster-whisper, Whisper models) and text-to-speech (Piper),
# both local, kept in memory. Listens on 127.0.0.1 only. Stdlib HTTP, one request at a time per route.
import io, json, os, sys, threading, wave, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = os.environ.get('FABRO_VOICE_MODELS', '.')
_stt = {'name': None, 'model': None}
_tts = {}
_stt_lock = threading.Lock()
_tts_lock = threading.Lock()

def stt_model(name):
    if _stt['name'] != name:
        from faster_whisper import WhisperModel
        path = os.path.join(MODELS, 'whisper', name)
        _stt['model'] = WhisperModel(path if os.path.isdir(path) else name, device='cpu', compute_type='int8', download_root=os.path.join(MODELS, 'whisper'),
                                     cpu_threads=max(1, (os.cpu_count() or 4) // 2))
        _stt['name'] = name
    return _stt['model']

def tts_voice(path):
    if path not in _tts:
        from piper import PiperVoice
        _tts[path] = PiperVoice.load(path)
    return _tts[path]

def pcm16_from_wav(data):
    import numpy as np
    with wave.open(io.BytesIO(data)) as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    a = np.frombuffer(raw, dtype=np.int16 if sw == 2 else np.uint8).astype('float32')
    a = a / (32768.0 if sw == 2 else 128.0) - (0 if sw == 2 else 1)
    if ch > 1: a = a.reshape(-1, ch).mean(axis=1)
    if sr != 16000:
        n = int(len(a) * 16000 / sr)
        a = np.interp(np.linspace(0, len(a), n, endpoint=False), np.arange(len(a)), a).astype('float32')
    return a

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == '/health': return self._json(200, {'ok': True, 'stt': _stt['name'], 'tts': list(_tts.keys())})
        self._json(404, {})
    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0')); body = self.rfile.read(n)
        try:
            if self.path.startswith('/transcribe'):
                # any audio/video file on disk (mp3, m4a, ogg, mp4…): faster-whisper decodes it with PyAV
                j = json.loads(body or b'{}'); t0 = time.time()
                with _stt_lock:
                    m = stt_model(j.get('model', 'base'))
                    segs, info = m.transcribe(j['path'], language=j.get('lang') or None, beam_size=1, vad_filter=True)
                    out = [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segs]
                return self._json(200, {'segments': out, 'text': ' '.join(x['text'] for x in out), 'language': info.language, 'duration': round(info.duration, 1), 'ms': int((time.time() - t0) * 1000)})
            if self.path.startswith('/stt'):
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(self.path).query)
                model = q.get('model', ['base'])[0]; lang = q.get('lang', [None])[0] or None; prompt = q.get('prompt', [None])[0]
                t0 = time.time()
                with _stt_lock:
                    m = stt_model(model)
                    segs, info = m.transcribe(pcm16_from_wav(body), language=lang, beam_size=1, vad_filter=True, initial_prompt=prompt, condition_on_previous_text=False)
                    text = ''.join(s.text for s in segs).strip()
                return self._json(200, {'text': text, 'language': info.language, 'prob': round(info.language_probability, 3), 'ms': int((time.time() - t0) * 1000)})
            if self.path.startswith('/tts'):
                j = json.loads(body or b'{}')
                v = tts_voice(j['voice'])
                buf = io.BytesIO()
                with _tts_lock:
                    with wave.open(buf, 'wb') as w:
                        from piper import SynthesisConfig
                        cfg = SynthesisConfig(length_scale=1.0 / max(0.5, min(2.0, float(j.get('speed', 1.0)))))
                        v.synthesize_wav(j['text'], w, syn_config=cfg)
                b = buf.getvalue()
                self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
                return
            self._json(404, {})
        except Exception as e:
            self._json(500, {'error': f'{type(e).__name__}: {e}'})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    print(json.dumps({'port': srv.server_address[1]}), flush=True)
    srv.serve_forever()
