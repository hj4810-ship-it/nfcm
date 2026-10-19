from PIL import Image
im = Image.open(r"state-taskbar.png")
w, h = im.size
print("size", w, h)
# locate the tile: crop a band around each pinned icon for a closer look
box = (740, 0, 860, h)
im.crop(box).resize(((box[2]-box[0])*8, h*8), Image.LANCZOS).save("state-tile.png")
