# Fabro Computer Use — Linux (X11) helper. Same JSON-lines protocol as the Windows helper.
# Needs python-xlib (installed by Fabro in its own Python). Input goes through the XTEST extension.
import json, os, sys, time, zlib, struct, shutil, subprocess, threading

from Xlib import X, XK, display as xdisplay
from Xlib.ext import xtest, randr

D = xdisplay.Display()
ROOT = D.screen().root
OUT = threading.Lock()
exp = [None, None]        # where Fabro last put the cursor
interrupt = [None]


def write(obj):
    s = json.dumps(obj, ensure_ascii=False)
    with OUT:
        sys.stdout.write(s + '\n'); sys.stdout.flush()


def atom(name):
    return D.intern_atom(name)


def prop(win, name):
    try:
        p = win.get_full_property(atom(name), X.AnyPropertyType)
        return p.value if p else None
    except Exception:
        return None


def monitors():
    g = ROOT.get_geometry()
    mons = []
    try:
        res = randr.get_monitors(ROOT, True)
        for m in res.monitors:
            mons.append({'x': m.x, 'y': m.y, 'w': m.width_in_pixels, 'h': m.height_in_pixels, 'primary': bool(m.primary), 'scale': 1.0, 'name': D.get_atom_name(m.name)})
    except Exception:
        pass
    if not mons:
        mons = [{'x': 0, 'y': 0, 'w': g.width, 'h': g.height, 'primary': True, 'scale': 1.0, 'name': 'screen'}]
    return mons, [0, 0, g.width, g.height]


def png(path, w, h, raw):
    # raw is BGRX (ZPixmap, 32 bpp): convert to RGB rows with a filter byte each
    rgb = bytearray(w * h * 3)
    rgb[0::3] = raw[2::4]; rgb[1::3] = raw[1::4]; rgb[2::3] = raw[0::4]
    stride = w * 3
    rows = b''.join(b'\x00' + bytes(rgb[i * stride:(i + 1) * stride]) for i in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 1)) + chunk(b'IEND', b''))


def capture(r):
    mons, v = monitors()
    x, y, w, h = r.get('x', 0), r.get('y', 0), r.get('w', 0), r.get('h', 0)
    if w <= 0 or h <= 0:
        x, y, w, h = v
    img = ROOT.get_image(x, y, w, h, X.ZPixmap, 0xffffffff)
    raw = img.data
    if r.get('cursor', True):
        # X does not draw the pointer into screenshots: draw a small arrow where it is
        q = ROOT.query_pointer()
        raw = bytearray(raw)
        cx, cy = q.root_x - x, q.root_y - y
        shape = ['X', 'XX', 'XoX', 'XooX', 'XoooX', 'XooooX', 'XoooooX', 'XooooooX', 'XoooooooX', 'XooooXXXXX', 'XooXooX', 'XoX XooX', 'XX  XooX', 'X    XooX', '     XooX', '      XX']
        for dy, row in enumerate(shape):
            for dx, ch in enumerate(row):
                px, py = cx + dx, cy + dy
                if ch == ' ' or px < 0 or py < 0 or px >= w or py >= h:
                    continue
                i = (py * w + px) * 4
                c = 0 if ch == 'X' else 255
                raw[i] = raw[i + 1] = raw[i + 2] = c
    png(r['path'], w, h, raw)
    q = ROOT.query_pointer()
    return {'x': x, 'y': y, 'w': w, 'h': h, 'path': r['path'], 'cursor': [q.root_x, q.root_y]}


def keycode_for(name):
    ks = XK.string_to_keysym(name)
    if ks == 0 and len(name) == 1:
        ks = ord(name) if ord(name) < 0x100 else 0x01000000 | ord(name)
    if ks == 0:
        raise Exception('unknown key ' + name)
    kc = D.keysym_to_keycode(ks)
    shift = False
    if kc:
        # does this keysym need Shift on that key?
        if D.keycode_to_keysym(kc, 0) != ks and D.keycode_to_keysym(kc, 1) == ks:
            shift = True
        return kc, shift
    return remap(ks), False


_spare = [None]
def remap(ks):
    # a keysym no key produces (é on a US layout, emoji…): map it on a spare keycode for a moment
    if _spare[0] is None:
        mn, mx = D.display.info.min_keycode, D.display.info.max_keycode
        km = D.get_keyboard_mapping(mn, mx - mn + 1)
        for i, syms in enumerate(km):
            if not any(syms):
                _spare[0] = mn + i
        if _spare[0] is None:
            _spare[0] = mx
    kc = _spare[0]
    D.change_keyboard_mapping(kc, [(ks, ks)])
    D.sync(); time.sleep(0.01)
    return kc


def key(kc, down):
    xtest.fake_input(D, X.KeyPress if down else X.KeyRelease, kc)
    D.sync()


BTN = {'left': 1, 'middle': 2, 'right': 3, 'x1': 8, 'x2': 9}


def check_user():
    if interrupt[0] or exp[0] is None:
        return
    q = ROOT.query_pointer()
    if abs(q.root_x - exp[0]) > 6 or abs(q.root_y - exp[1]) > 6:
        interrupt[0] = 'mouse'
        write({'event': 'user', 'kind': 'mouse'})


def play(r):
    done, held = 0, []
    q = ROOT.query_pointer(); exp[0], exp[1] = q.root_x, q.root_y  # start from where the pointer really is
    t0 = time.perf_counter()
    for s in r.get('steps', []):
        if watching[0]:
            check_user()
        if interrupt[0]:
            break
        t = s.get('t')
        if t == 'move':
            xtest.fake_input(D, X.MotionNotify, x=int(s['x']), y=int(s['y'])); D.sync(); exp[0], exp[1] = int(s['x']), int(s['y'])
        elif t == 'rel':
            q = ROOT.query_pointer(); nx, ny = q.root_x + int(s['dx']), q.root_y + int(s['dy'])
            xtest.fake_input(D, X.MotionNotify, x=nx, y=ny); D.sync(); exp[0], exp[1] = nx, ny
        elif t in ('down', 'up'):
            b = BTN.get(s.get('b') or 'left', 1)
            xtest.fake_input(D, X.ButtonPress if t == 'down' else X.ButtonRelease, b); D.sync()
            if t == 'down': held.append(('b', b))
            else: held[:] = [h for h in held if h != ('b', b)]
        elif t == 'wheel':
            d = int(s.get('d', 0)); n = max(1, abs(d) // 120)
            b = (7 if d > 0 else 6) if s.get('h') else (4 if d > 0 else 5)
            for _ in range(n):
                xtest.fake_input(D, X.ButtonPress, b); xtest.fake_input(D, X.ButtonRelease, b)
            D.sync()
        elif t in ('kd', 'ku'):
            name = s.get('ks') or s.get('ch')
            kc, _ = keycode_for(name)
            key(kc, t == 'kd')
            if t == 'kd': held.append(('k', kc))
            else: held[:] = [h for h in held if h != ('k', kc)]
        elif t == 'text':
            ms = s.get('ms', 0) / 1000.0
            shift_kc = D.keysym_to_keycode(XK.string_to_keysym('Shift_L'))
            for ch in s.get('s', ''):
                if interrupt[0]: break
                if ch == '\r': continue
                name = {'\n': 'Return', '\t': 'Tab', ' ': 'space'}.get(ch, ch)
                kc, shift = keycode_for(name)
                if shift: key(shift_kc, True)
                key(kc, True); key(kc, False)
                if shift: key(shift_kc, False)
                if ms: time.sleep(ms)
        elif t == 'sleep':
            pass
        else:
            raise Exception('unknown step ' + str(t))
        ms = s.get('ms', 0) if t != 'text' else 0
        if ms:
            time.sleep(ms / 1000.0)
        done += 1
    for h in reversed(held):
        try:
            if h[0] == 'b': xtest.fake_input(D, X.ButtonRelease, h[1])
            else: key(h[1], False)
        except Exception:
            pass
    D.sync()
    q = ROOT.query_pointer()
    return {'done': done, 'interrupted': interrupt[0], 'cursor': [q.root_x, q.root_y]}


def windows():
    out = []
    active = prop(ROOT, '_NET_ACTIVE_WINDOW')
    active = active[0] if active is not None and len(active) else 0
    ids = prop(ROOT, '_NET_CLIENT_LIST_STACKING') or prop(ROOT, '_NET_CLIENT_LIST') or []
    for z, wid in enumerate(reversed(list(ids))):
        w = D.create_resource_object('window', wid)
        try:
            name = prop(w, '_NET_WM_NAME')
            name = name.decode('utf-8', 'replace') if isinstance(name, (bytes, bytearray)) else (w.get_wm_name() or '')
            g = w.get_geometry(); c = w.translate_coords(ROOT, 0, 0)
            pid = prop(w, '_NET_WM_PID'); pid = int(pid[0]) if pid is not None and len(pid) else 0
            cls = w.get_wm_class() or ('', '')
            state = prop(w, '_NET_WM_STATE') or []
            hidden = atom('_NET_WM_STATE_HIDDEN') in list(state)
            out.append({'hwnd': wid, 'title': name, 'cls': cls[1], 'pid': pid, 'app': cls[0], 'rect': [-c.x, -c.y, g.width, g.height],
                        'minimized': hidden, 'maximized': atom('_NET_WM_STATE_MAXIMIZED_VERT') in list(state), 'focused': wid == active, 'z': z, 'elevated': 0})
        except Exception:
            continue
    return out


def client_msg(win, name, data):
    from Xlib.protocol import event
    ev = event.ClientMessage(window=win, client_type=atom(name), data=(32, (data + [0] * 5)[:5]))
    ROOT.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
    D.sync()


def window_op(r):
    w = D.create_resource_object('window', int(r['hwnd']))
    a = r.get('action')
    if a in ('focus', 'restore'):
        client_msg(w, '_NET_ACTIVE_WINDOW', [1, X.CurrentTime, 0])
        try: w.set_input_focus(X.RevertToParent, X.CurrentTime); w.configure(stack_mode=X.Above)
        except Exception: pass
    elif a == 'minimize':
        client_msg(w, 'WM_CHANGE_STATE', [3])
    elif a == 'maximize':
        client_msg(w, '_NET_WM_STATE', [1, atom('_NET_WM_STATE_MAXIMIZED_VERT'), atom('_NET_WM_STATE_MAXIMIZED_HORZ'), 1])
    elif a == 'close':
        client_msg(w, '_NET_CLOSE_WINDOW', [X.CurrentTime, 1])
    D.sync(); time.sleep(0.1)
    g = w.get_geometry(); c = w.translate_coords(ROOT, 0, 0)
    act = prop(ROOT, '_NET_ACTIVE_WINDOW')
    return {'focused': bool(act is not None and len(act) and act[0] == int(r['hwnd'])), 'rect': [-c.x, -c.y, g.width, g.height]}


def _tess(exe, path, psm, langs):
    args = [exe, path, '-', '--psm', str(psm)] + (['-l', langs] if langs else []) + ['tsv']
    p = subprocess.run(args, capture_output=True, text=True, timeout=60)
    words = {}
    for row in p.stdout.splitlines()[1:]:
        c = row.split('\t')
        if len(c) < 12 or not c[11].strip() or float(c[10] or -1) < 40:
            continue
        words.setdefault((c[1], c[2], c[3], c[4]), []).append((int(c[6]), int(c[7]), int(c[8]), int(c[9]), c[11]))
    return [seg for ws in words.values() for seg in split_gaps(ws)]


def split_gaps(ws):
    # one OCR "line" can join things far apart on the same row (a button and a label): split at big gaps
    ws = sorted(ws)
    out, cur = [], None
    for x, y, w, h, t in ws:
        if cur and x - cur[2] > max(18, 1.3 * max(h, cur[3] - cur[1])):
            out.append(cur); cur = None
        if cur is None:
            cur = [x, y, x + w, y + h, [t]]
        else:
            cur[0] = min(cur[0], x); cur[1] = min(cur[1], y); cur[2] = max(cur[2], x + w); cur[3] = max(cur[3], y + h); cur[4].append(t)
    if cur:
        out.append(cur)
    return out


def ocr(r):
    exe = shutil.which('tesseract')
    if not exe:
        raise Exception('Text recognition needs tesseract on Linux (sudo apt install tesseract-ocr).')
    scale = float(r.get('scale') or 1)
    try:
        have = subprocess.run([exe, '--list-langs'], capture_output=True, text=True, timeout=20).stdout.split()
    except Exception:
        have = []
    langs = '+'.join([l for l in ('eng', 'fra', 'spa', 'deu') if l in have])
    # page layout (finds text in blocks, light on dark too) + sparse text (scattered labels), on the
    # picture and on a black & white version of it (coloured backgrounds), merged
    found = []
    for path in [r['path']] + list(r.get('more') or []):
        for psm in (3, 11):
            for L in _tess(exe, path, psm, langs):
                if not any(not (L[2] < o[0] or L[0] > o[2] or L[3] < o[1] or L[1] > o[3]) for o in found):
                    found.append(L)
    return {'lines': [{'text': ' '.join(v[4]), 'rect': [int(v[0] / scale), int(v[1] / scale), int((v[2] - v[0]) / scale), int((v[3] - v[1]) / scale)]} for v in found], 'lang': 'tesseract ' + (langs or 'default')}


watching = [False]


def dispatch(op, r):
    if op == 'hello':
        mons, v = monitors()
        return {'pid': os.getpid(), 'monitors': mons, 'virtual': v, 'elevated': False, 'os': 'Linux X11'}
    if op == 'capture': return capture(r)
    if op == 'cursor':
        q = ROOT.query_pointer(); return {'x': q.root_x, 'y': q.root_y}
    if op == 'play': return play(r)
    if op == 'watch':
        watching[0] = bool(r.get('on')); interrupt[0] = None; return {'watching': watching[0]}
    if op == 'resume':
        interrupt[0] = None; return {}
    if op == 'windows': return {'windows': windows()}
    if op == 'window': return window_op(r)
    if op == 'elements': return {'elements': [], 'truncated': False, 'ms': 0}
    if op == 'point':
        return {'hwnd': 0, 'pid': 0, 'app': '', 'title': ''}
    if op == 'focused': return {}
    if op == 'ocr': return ocr(r)
    raise Exception('unknown op ' + str(op))


def main():
    write({'event': 'ready', 'pid': os.getpid()})
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        rid = None
        try:
            r = json.loads(line); rid = r.get('id')
            res = dispatch(r.get('op'), r); res['id'] = rid; res['ok'] = True
        except Exception as e:
            res = {'id': rid, 'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
        write(res)


if __name__ == '__main__':
    main()
