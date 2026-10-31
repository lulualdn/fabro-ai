# Fabro voice server: speech-to-text (faster-whisper, Whisper models) and text-to-speech (Kokoro, multilingual
# and fluid; Piper for the languages Kokoro doesn't speak), all local, kept in memory. Listens on 127.0.0.1 only.
# Stdlib HTTP, one request at a time per route.
import io, json, os, re, sys, threading, wave, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = os.environ.get('FABRO_VOICE_MODELS', '.')
_stt = {'name': None, 'model': None}
_tts = {}
_kokoro = {'model': None}
_stt_lock = threading.Lock()
_tts_lock = threading.Lock()

def stt_model(name):
    if _stt['name'] != name:
        from faster_whisper import WhisperModel
        path = os.path.join(MODELS, 'whisper', name)
        n = os.cpu_count() or 4
        _stt['model'] = WhisperModel(path if os.path.isdir(path) else name, device='cpu', compute_type='int8', download_root=os.path.join(MODELS, 'whisper'),
                                     cpu_threads=max(2, min(8, n - 2)))
        _stt['name'] = name
    return _stt['model']

def tts_voice(path):
    if path not in _tts:
        from piper import PiperVoice
        _tts[path] = PiperVoice.load(path)
    return _tts[path]

def kokoro():
    if _kokoro['model'] is None:
        from kokoro_onnx import Kokoro
        d = os.path.join(MODELS, 'kokoro')
        _kokoro['model'] = Kokoro(os.path.join(d, 'kokoro-v1.0.int8.onnx'), os.path.join(d, 'voices-v1.0.bin'))
    return _kokoro['model']

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
    return (a - float(a.mean())).astype('float32') if len(a) else a  # no DC offset (cheap mics)

# What Whisper "hears" in silence or breath noise (subtitle credits, sign-offs): never real dictation.
HALLU = re.compile(r"^\s*(sous-titr|sous titr|merci d.avoir regard|abonnez-vous|thanks? for watching|thank you\.?$|subtitles? by|amara\.org|untertitel|gracias por ver|\.+$|…+$)", re.I)

def transcribe_pcm(m, pcm, lang, prompt, hot, beam):
    # Whispers and very soft speech fall under the default voice-activity threshold: a lower one, a long pad,
    # and a second pass without the VAD when the first one heard nothing.
    kw = dict(language=lang, beam_size=beam, initial_prompt=prompt or None, condition_on_previous_text=False,
              no_speech_threshold=0.75, temperature=[0.0, 0.2, 0.4, 0.6])
    if hot:
        kw['hotwords'] = hot
    segs, info = m.transcribe(pcm, vad_filter=True, vad_parameters=dict(threshold=0.3, min_silence_duration_ms=500, speech_pad_ms=320), **kw)
    text = ''.join(s.text for s in segs).strip()
    if not text and len(pcm) > 16000 * 0.4:
        segs, info = m.transcribe(pcm, vad_filter=False, **kw)
        text = ''.join(s.text for s in segs if s.no_speech_prob < 0.85).strip()
    if HALLU.search(text):
        text = ''
    return text, info

def kokoro_wav(segments, speed):
    # segments: [{text, voice, lang}] — one per sentence, each in its own language, joined with a short breath
    import numpy as np
    k = kokoro(); out = []; sr = 24000
    for i, s in enumerate(segments):
        t = str(s.get('text') or '').strip()
        if not t: continue
        audio, sr = k.create(t, voice=s.get('voice') or 'af_heart', speed=speed, lang=s.get('lang') or 'en-us')
        if out: out.append(np.zeros(int(sr * 0.12), dtype='float32'))
        out.append(audio.astype('float32'))
    a = np.concatenate(out) if out else np.zeros(1, dtype='float32')
    pcm = (np.clip(a, -1, 1) * 32767).astype('<i2').tobytes()
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm)
    return buf.getvalue()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _wav(self, b):
        self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == '/health':
            ok = True
            try:
                import kokoro_onnx  # noqa
            except Exception:
                ok = False
            return self._json(200, {'ok': True, 'stt': _stt['name'], 'tts': list(_tts.keys()), 'kokoro': ok})
        self._json(404, {})
    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0')); body = self.rfile.read(n)
        try:
            if self.path.startswith('/transcribe'):
                # any audio/video file on disk (mp3, m4a, ogg, mp4…): faster-whisper decodes it with PyAV
                j = json.loads(body or b'{}'); t0 = time.time()
                with _stt_lock:
                    m = stt_model(j.get('model', 'base'))
                    segs, info = m.transcribe(j['path'], language=j.get('lang') or None, beam_size=1, vad_filter=True, hotwords=j.get('hot') or None)
                    out = [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segs]
                return self._json(200, {'segments': out, 'text': ' '.join(x['text'] for x in out), 'language': info.language, 'duration': round(info.duration, 1), 'ms': int((time.time() - t0) * 1000)})
            if self.path.startswith('/stt'):
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(self.path).query)
                model = q.get('model', ['base'])[0]; lang = q.get('lang', [None])[0] or None
                prompt = q.get('prompt', [None])[0]; hot = q.get('hot', [None])[0]; beam = int(q.get('beam', ['5'])[0])
                t0 = time.time()
                with _stt_lock:
                    m = stt_model(model)
                    text, info = transcribe_pcm(m, pcm16_from_wav(body), lang, prompt, hot, beam)
                return self._json(200, {'text': text, 'language': info.language, 'prob': round(info.language_probability, 3), 'ms': int((time.time() - t0) * 1000), 'model': model})
            if self.path.startswith('/tts'):
                j = json.loads(body or b'{}')
                speed = max(0.5, min(2.0, float(j.get('speed', 1.0))))
                if j.get('engine') == 'kokoro':
                    with _tts_lock:
                        return self._wav(kokoro_wav(j.get('segments') or [{'text': j.get('text', ''), 'voice': j.get('voice'), 'lang': j.get('lang')}], speed))
                v = tts_voice(j['voice'])
                buf = io.BytesIO()
                with _tts_lock:
                    with wave.open(buf, 'wb') as w:
                        from piper import SynthesisConfig
                        cfg = SynthesisConfig(length_scale=1.0 / speed)
                        v.synthesize_wav(j['text'], w, syn_config=cfg)
                return self._wav(buf.getvalue())
            self._json(404, {})
        except Exception as e:
            self._json(500, {'error': f'{type(e).__name__}: {e}'})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    print(json.dumps({'port': srv.server_address[1]}), flush=True)
    srv.serve_forever()
