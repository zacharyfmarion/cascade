#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PUBLIC_DIR="${WEB_DIR}/public"

FONT_BOLD="/System/Library/Fonts/Supplemental/Verdana Bold.ttf"
FONT_REGULAR="/System/Library/Fonts/Supplemental/Verdana.ttf"
ICON_PATH="${PUBLIC_DIR}/favicon.png"
OUTPUT_PATH="${PUBLIC_DIR}/og-image.png"

magick -size 1200x630 xc:'#071018' \
  -fill '#0c1d2b' -draw "rectangle 0,0 1200,630" \
  -fill '#133655' -draw "circle 1088,112 1240,112" \
  -fill '#12324f' -draw "circle 128,548 358,548" \
  -fill '#142c40' -draw "roundrectangle 86,92 1114,540 30,30" \
  \( "${ICON_PATH}" -resize 156x156 \) -geometry +126+126 -composite \
  -font "${FONT_BOLD}" -fill '#f5f7fb' -pointsize 66 -annotate +328+194 'Cascade' \
  \( -background none -fill '#edf3fb' -font "${FONT_BOLD}" -pointsize 31 -size 720x92 \
      caption:'Turn one-off edits into repeatable image workflows' \) \
    -gravity northwest -geometry +328+218 -composite \
  \( -background none -fill '#8bb7ff' -font "${FONT_REGULAR}" -pointsize 24 -size 700x40 \
      caption:'Cleanup • variants • look-dev • custom effects' \) \
    -gravity northwest -geometry +328+324 -composite \
  \( -background none -fill '#c7d4e3' -font "${FONT_REGULAR}" -pointsize 24 -size 860x96 \
      caption:'Build a cleanup, look, or effect once, then reuse it across product shots, social variants, and creative experiments.' \) \
    -gravity northwest -geometry +126+412 -composite \
  "${OUTPUT_PATH}"
