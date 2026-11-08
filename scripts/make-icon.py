"""生成 JToolsBox 应用图标：黄底黑字「JT」。

用法：
    python scripts/make-icon.py            # 1024x1024 源图
    python scripts/make-icon.py --android  # 额外覆盖 Android 自适应图标前景层

源图产出 src-tauri/icons/app-icon.png，之后用
`npx tauri icon src-tauri/icons/app-icon.png` 生成全平台图标。
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (255, 200, 0)      # 亮黄
FG = (17, 17, 17)       # 近黑
TEXT = "JT"
TRACK_RATIO = -0.061    # 字间距占字号比例（负值收紧）
FONT_CANDIDATES = [
    "C:/Windows/Fonts/ariblk.ttf",   # Arial Black
    "C:/Windows/Fonts/seguibl.ttf",  # Segoe UI Black
    "C:/Windows/Fonts/arialbd.ttf",
]

# Android 自适应图标：108dp 画布，内容需落在中间 72dp 安全区内
ANDROID_DENSITIES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}
ANDROID_RES = Path("src-tauri/gen/android/app/src/main/res")


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("找不到可用的粗体字体")


def measure(font: ImageFont.FreeTypeFont, draw: ImageDraw.ImageDraw):
    glyphs = [draw.textbbox((0, 0), ch, font=font) for ch in TEXT]
    widths = [g[2] - g[0] for g in glyphs]
    tracking = TRACK_RATIO * font.size
    total_w = sum(widths) + tracking * (len(TEXT) - 1)
    top = min(g[1] for g in glyphs)
    bottom = max(g[3] for g in glyphs)
    return glyphs, widths, total_w, top, bottom, tracking


def draw_word(
    img: Image.Image,
    width_ratio: float,
    color: tuple[int, ...],
    optical_shift: float = -0.012,
) -> None:
    """在画布上居中绘制 JT，宽度占画布 width_ratio。"""
    size = img.width
    draw = ImageDraw.Draw(img)

    # 先按基准字号测量，再按目标宽度反推精确字号
    base_size = int(size * 0.48)
    _, _, total_w, _, _, _ = measure(load_font(base_size), draw)
    font = load_font(max(1, int(base_size * (size * width_ratio) / total_w)))

    glyphs, widths, total_w, top, bottom, tracking = measure(font, draw)
    total_h = bottom - top
    x = (size - total_w) / 2
    # J 的圆弧下伸会压低视觉重心，整体上移做光学居中
    y = (size - total_h) / 2 - top - size * optical_shift

    for ch, g, w in zip(TEXT, glyphs, widths):
        draw.text((x - g[0], y), ch, font=font, fill=color)
        x += w + tracking


def render(size: int = SIZE) -> Image.Image:
    img = Image.new("RGB", (size, size), BG)
    draw_word(img, width_ratio=0.615, color=FG)
    return img


def render_foreground(size: int) -> Image.Image:
    """透明背景 + 收紧的 JT，供 Android 自适应图标叠加在纯黄背景上。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # 内容落在 72dp 安全区内，实际占画布约 46%
    draw_word(img, width_ratio=0.46, color=(*FG, 255), optical_shift=-0.015)
    return img


def write_android_foregrounds() -> None:
    for density, px in ANDROID_DENSITIES.items():
        out = ANDROID_RES / f"mipmap-{density}" / "ic_launcher_foreground.png"
        if not out.parent.exists():
            continue
        render_foreground(px).save(out, "PNG")
        print(f"已更新 {out}")


def write_android_background_color() -> None:
    """自适应图标背景层用与源图一致的黄色，避免圆形裁切后露出白角。"""
    for name in ("ic_launcher_background.xml",):
        for values in ("values", "values-night"):
            path = ANDROID_RES / values / name
            if not path.exists():
                continue
            path.write_text(
                '<?xml version="1.0" encoding="utf-8"?>\n'
                "<resources>\n"
                '  <color name="ic_launcher_background">#FFC800</color>\n'
                "</resources>\n",
                encoding="utf-8",
            )
            print(f"已更新 {path}")


def main() -> None:
    out = Path("src-tauri/icons/app-icon.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    render().save(out, "PNG")
    print(f"已生成 {out.resolve()}")

    if "--android" in sys.argv:
        write_android_foregrounds()
        write_android_background_color()


if __name__ == "__main__":
    main()
