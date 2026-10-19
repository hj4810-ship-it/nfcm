from PIL import Image
im = Image.open(r"harness-icon.ico")
print(im.info.get("sizes"))
frames = []
for s in (16, 32, 48, 256):
    im.size = (s, s)
    im.load()
    f = im.convert("RGB")
    f.save(f"frame_{s}.png")
    print(s, f.size, f.getpixel((0,0)), f.getpixel((s//2, s//2)))
# montage 16/32/48 upscaled
out = Image.new("RGB", (16*8 + 32*8 + 48*8 + 20, 48*8), (0,0,0))
x = 0
for s in (16, 32, 48):
    f = Image.open(f"frame_{s}.png").resize((s*8, s*8), Image.NEAREST)
    out.paste(f, (x, 0)); x += s*8 + 10
out.save("frames_montage.png")
