from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent
SS = 3
SCALE = 6.4
MARGIN = 46

# Object extents in mm-like units.
X0, X1 = -60.0, 60.0
Y0, Y1 = -40.0, 40.0
Z0, Z1 = 0.0, 120.0

LINE = 3.6


def canvas_for(width_units, height_units):
    w = int(round(width_units * SCALE)) + MARGIN * 2
    h = int(round(height_units * SCALE)) + MARGIN * 2
    image = Image.new("RGB", (w * SS, h * SS), "white")
    return image, ImageDraw.Draw(image)


def px(x, y):
    return ((MARGIN + x * SCALE) * SS, (MARGIN + y * SCALE) * SS)


def line(draw, points, close=False):
    pts = [px(x, y) for x, y in points]
    if close:
        pts.append(pts[0])
    draw.line(pts, fill="black", width=int(LINE * SS), joint="curve")
    # Round the free ends / corners.
    r = LINE * SS * 0.5
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill="black")


def rect(draw, a, b):
    x0, y0 = a
    x1, y1 = b
    line(draw, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)


def save(image, name):
    image = image.resize((image.width // SS, image.height // SS), Image.LANCZOS)
    image.save(OUT / name, optimize=True)
    print(name, image.size)


def front_pt(x, z):
    return (x - X0, Z1 - z)


def top_pt(x, y):
    return (x - X0, y - Y0)


def side_pt(y, z):
    return (y - Y0, Z1 - z)


# ---------------------------------------------------------------- front (X/Z)
image, draw = canvas_for(X1 - X0, Z1 - Z0)
# Base plate
rect(draw, front_pt(X0, Z0), front_pt(X1, 16))
# Upright + gusset silhouette is one 72-wide rectangle in front view.
line(
    draw,
    [front_pt(-36, 16), front_pt(36, 16), front_pt(36, 120), front_pt(-36, 120)],
    close=True,
)
# Visible internal edges: gusset top, top bevel, base top.
line(draw, [front_pt(-36, 76), front_pt(36, 76)])
line(draw, [front_pt(-36, 112), front_pt(36, 112)])
line(draw, [front_pt(X0, 16), front_pt(X1, 16)])
save(image, "demo-front.png")

# ------------------------------------------------------------------ top (X/Y)
image, draw = canvas_for(X1 - X0, Y1 - Y0)
rect(draw, top_pt(X0, Y0), top_pt(X1, Y1))
# Upright strip at the back.
rect(draw, top_pt(-36, 24), top_pt(36, 40))
# Gusset footprint / edges.
line(
    draw,
    [top_pt(-36, -14), top_pt(36, -14), top_pt(36, 24), top_pt(-36, 24)],
    close=True,
)
save(image, "demo-top.png")

# ----------------------------------------------------------------- side (Y/Z)
image, draw = canvas_for(Y1 - Y0, Z1 - Z0)
rect(draw, side_pt(Y0, Z0), side_pt(Y1, 16))
# Upright with chamfered top.
line(
    draw,
    [
        side_pt(24, 16),
        side_pt(24, 112),
        side_pt(40, 120),
        side_pt(40, 16),
    ],
    close=True,
)
# Triangular gusset.
line(draw, [side_pt(24, 76), side_pt(24, 16), side_pt(-14, 16)], close=True)
# Base top line.
line(draw, [side_pt(Y0, 16), side_pt(Y1, 16)])
save(image, "demo-side.png")
