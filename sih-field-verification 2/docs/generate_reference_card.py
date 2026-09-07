"""
Generates the physical reference colour card the app expects operators to
hold in-frame next to the vial (right half of the on-screen capture guide).

Design rationale - this must match the code, not just look nice:
- backend/src/utils/colorAnalysis.js (and the on-device App.jsx preview)
  both do a GREY-WORLD correction: they average the whole card region and
  assume that average SHOULD be neutral (R=G=B). Any deviation is treated
  as a lighting colour cast and used to correct the vial's sampled colour.
- That assumption only holds if the card is one flat, matte, neutral-grey
  surface with no print texture, gloss, or secondary colours in the sampled
  zone. So the card is deliberately plain - not a multi-patch colour
  checker - because the current calibration code only ever reads one
  average colour from it.
- Printed at fixed, known coordinates on an A4 sheet with corner registration
  marks and a numeric colour-swatch target (the "AIM" box) so:
  (a) a judge/operator can visually sanity-check the print against the
      printed target values, and
  (b) if the print run comes out off-grey (common with cheap printers/toner),
      you can re-measure the printed card with any colour picker and adjust
      the target, rather than silently trusting an inaccurate card.

Output: reference_colour_card.pdf - one A4 sheet, 3 ID-card-sized
(85.6 x 54.0 mm) cards with cut lines, so you get spares from one print.

Usage:
    pip install reportlab
    python generate_reference_card.py
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, black, white

# --- calibration target -----------------------------------------------
# Printed mid-grey target. Exact reflectance doesn't matter for the
# grey-world assumption (any true neutral works) - what matters is that
# R=G=B in the actual print. sRGB 128 in each channel is a practical,
# easy-to-verify mid-tone that isn't too dark (loses shadow detail on
# cheap cameras) or too bright (blows out / picks up more ambient glare).
TARGET_RGB = (128, 128, 128)
TARGET_HEX = "#{:02X}{:02X}{:02X}".format(*TARGET_RGB)
GREY = Color(TARGET_RGB[0] / 255, TARGET_RGB[1] / 255, TARGET_RGB[2] / 255)

CARD_W, CARD_H = 85.6 * mm, 54.0 * mm  # ISO/IEC 7810 ID-1, same as a bank card
MARGIN = 8 * mm
REG_LEN = 4 * mm  # corner registration mark arm length

PAGE_W, PAGE_H = A4


def draw_card(c, x, y):
    """Draws one card with its top-left corner at (x, y) on the page."""
    # Card body
    c.setFillColor(GREY)
    c.setStrokeColor(black)
    c.setLineWidth(0.4)
    c.rect(x, y - CARD_H, CARD_W, CARD_H, fill=1, stroke=1)

    # Corner registration marks (small L-brackets just outside the card),
    # so an operator aligning the card in the app's on-screen guide has a
    # clear visual reference for "flat, square, fully in frame".
    c.setStrokeColor(black)
    c.setLineWidth(0.6)
    corners = [
        (x, y, 1, -1), (x + CARD_W, y, -1, -1),
        (x, y - CARD_H, 1, 1), (x + CARD_W, y - CARD_H, -1, 1),
    ]
    for cx, cy, dx, dy in corners:
        c.line(cx, cy, cx + dx * REG_LEN, cy)
        c.line(cx, cy, cx, cy + dy * REG_LEN)

    # Cut lines (dashed, slightly outside the card edge)
    c.setDash(2, 2)
    c.setLineWidth(0.3)
    c.rect(x - 1, y - CARD_H - 1, CARD_W + 2, CARD_H + 2, fill=0, stroke=1)
    c.setDash()

    # Label + printed target value, small and along the bottom edge so it
    # sits outside the region the app actually samples from (see INSET in
    # colorAnalysis.js - the sampled zone is inset from the card's edges).
    label_color = white if sum(TARGET_RGB) < 400 else black
    c.setFillColor(label_color)
    c.setFont("Helvetica-Bold", 6)
    c.drawString(x + 3 * mm, y - CARD_H + 6.5 * mm, "FIELD VERIFICATION — REFERENCE CARD")
    c.setFont("Helvetica", 5.5)
    c.drawString(x + 3 * mm, y - CARD_H + 3 * mm, f"Target neutral grey: sRGB {TARGET_RGB[0]},{TARGET_RGB[1]},{TARGET_RGB[2]}")
    c.drawRightString(x + CARD_W - 3 * mm, y - CARD_H + 3 * mm, TARGET_HEX)


def draw_instructions(c, x, y, width):
    import textwrap
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x, y, "How to use")
    body_font, body_size = "Helvetica", 7.5
    c.setFont(body_font, body_size)
    # ~1.9 points per average character at 7.5pt Helvetica - wrap conservatively.
    chars_per_line = max(20, int(width / (body_size * 0.52)))
    lines = [
        "Print on plain MATTE paper at 100% scale (\"Actual size\", not \"fit to page\"). "
        "Do not laminate or use glossy stock - it causes glare.",
        "Cut along the dashed lines. Keep the card flat; a bent or creased card samples unevenly.",
        "During capture, hold this card in the right-hand box of the on-screen guide, "
        "alongside the vial in the left-hand box.",
        "Keep the grey surface lit by the same light as the vial - no shadow across it, "
        "no reflection or glare on it.",
        "If results look consistently off, re-measure a fresh print with any colour-picker "
        "tool. Toner/ink drift is common - the card should read close to the target value "
        "above before you trust the calibration.",
    ]
    ty = y - 14
    for i, line in enumerate(lines, start=1):
        wrapped = textwrap.wrap(line, width=chars_per_line)
        prefix = f"{i}. "
        indent = " " * len(prefix)
        for j, seg in enumerate(wrapped):
            c.drawString(x, ty, (prefix if j == 0 else indent) + seg)
            ty -= 9.5
        ty -= 2
    return ty


def main():
    c = canvas.Canvas("reference_colour_card.pdf", pagesize=A4)

    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, PAGE_H - MARGIN - 4 * mm, "Reference Colour Card — Field Verification System")

    # Three cards stacked down the left side of the page, with instructions
    # printed alongside on the first sheet.
    start_y = PAGE_H - MARGIN - 14 * mm
    gap = 10 * mm
    for i in range(3):
        card_y = start_y - i * (CARD_H + gap)
        draw_card(c, MARGIN, card_y)

    draw_instructions(c, MARGIN + CARD_W + 14 * mm, start_y - 4 * mm, PAGE_W - (MARGIN * 2 + CARD_W + 14 * mm))

    c.setFont("Helvetica-Oblique", 7)
    c.setFillColor(black)
    c.drawString(MARGIN, MARGIN, "One flat neutral-grey surface, matching the grey-world calibration read in backend/src/utils/colorAnalysis.js.")

    c.showPage()
    c.save()
    print("Wrote reference_colour_card.pdf")


if __name__ == "__main__":
    main()
