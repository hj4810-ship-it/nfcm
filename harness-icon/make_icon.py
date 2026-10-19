from PIL import Image

SRC = r"source.jpg"
img = Image.open(SRC).convert("RGB")
W, H = img.size
print("source", W, H)

# Variant A: full-height center square
s = min(W, H)
left = (W - s) // 2
box_a = (left, 0, left + s, s)

# Variant B: tighter crop around head + rice cooker
box_b = (156, 80, 956, 880)

for name, box in (("a", box_a), ("b", box_b)):
    crop = img.crop(box).resize((512, 512), Image.LANCZOS)
    crop.save(f"preview_{name}.png")
    crop.save(f"preview_{name}_128.png")
    print(name, box)
