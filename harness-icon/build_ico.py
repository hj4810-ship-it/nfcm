from PIL import Image

img = Image.open("source.jpg").convert("RGB")
box = (156, 80, 956, 880)
base = img.crop(box).resize((1024, 1024), Image.LANCZOS)
base.save("harness-icon-1024.png")

sizes = [256, 128, 96, 64, 48, 40, 32, 24, 20, 16]
base.save("harness-icon.ico", format="ICO", sizes=[(s, s) for s in sizes])

# also a 256 flat png for quick viewing
base.resize((256, 256), Image.LANCZOS).save("harness-icon-256.png")

with Image.open("harness-icon.ico") as ic:
    print("ico sizes:", sorted(ic.info.get("sizes", [])))
