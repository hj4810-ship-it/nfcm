import numpy as np
from PIL import Image

bar = Image.open("state-taskbar.png").convert("RGB")
icon = Image.open("harness-icon.ico")
icon.size = (32, 32)
icon.load()
tmpl32 = icon.convert("L")
tmpls = [tmpl32, tmpl32.resize((40, 40), Image.LANCZOS), tmpl32.resize((24, 24), Image.LANCZOS)]

barL = np.asarray(bar.convert("L"), dtype=np.float32)
best = None
for t in tmpls:
    a = np.asarray(t, dtype=np.float32)
    a = a - a.mean()
    denom_a = np.sqrt((a * a).sum())
    th, tw = a.shape
    H, W = barL.shape
    for y in range(0, H - th + 1):
        for x in range(0, W - tw + 1):
            patch = barL[y:y + th, x:x + tw]
            p = patch - patch.mean()
            d = np.sqrt((p * p).sum())
            if d < 1e-6:
                continue
            score = float((p * a).sum() / (d * denom_a))
            if best is None or score > best[0]:
                best = (score, x, y, tw, th)
print("best match:", best)

score, x, y, tw, th = best
pad = 10
crop = bar.crop((max(0, x - pad), 0, min(bar.size[0], x + tw + pad), bar.size[1]))
crop.resize((crop.size[0] * 8, crop.size[1] * 8), Image.NEAREST).save("state-tile.png")
print("saved state-tile.png", crop.size)
