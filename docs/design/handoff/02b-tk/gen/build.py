"""Build every frame to design/<stem>.dc.html and screenshot it to design/screens/<stem>.png.
Usage: python3 build.py [stem-filter]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
import core
import frames  # noqa: F401  (registers)
import frames2  # noqa: F401
import frames3  # noqa: F401
import frames4  # noqa: F401
from frames import FRAMES
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', 'design')
SIZES = {'kiosk': (1920, 1080), 'tablet': (1280, 800), 'phone': (390, 844), 'tv': (1920, 1080), 'component': (1920, 1080), 'slip': (576, 900), 'display': (1920, 1080)}

flt = sys.argv[1] if len(sys.argv) > 1 else None
todo = [f for f in FRAMES if not flt or flt in f['stem']]
for f in todo:
    core.L = f['lang']
    html = f['fn']()
    with open(os.path.join(ROOT, f['stem'] + '.dc.html'), 'w') as fh:
        fh.write(html)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for f in todo:
        w, h = SIZES[f['device']]
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto('file://' + os.path.abspath(os.path.join(ROOT, f['stem'] + '.dc.html')))
        pg.wait_for_timeout(250)
        el = pg.query_selector('.fr')
        el.screenshot(path=os.path.join(ROOT, 'screens', f['stem'] + '.png'))
        pg.close()
        print('ok', f['stem'])
    b.close()

json.dump([{k: v for k, v in f.items() if k != 'fn'} for f in FRAMES], open(os.path.join(ROOT, '..', 'frames.json'), 'w'), indent=1, ensure_ascii=False)
