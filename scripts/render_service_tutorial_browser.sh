#!/bin/sh
set -eu

OUTPUT_PATH="${1:-docs/media/tutorial-crear-servicio-catering.mp4}"
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
HTML_PATH="$(pwd)/scripts/service_tutorial.html"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TEMP_DIR="/private/tmp/horekia-service-tutorial-$$"

mkdir -p "$OUTPUT_DIR" "$TEMP_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

for SCENE in 0 1 2; do
  "$CHROME_BIN" \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --hide-scrollbars \
    --window-size=1280,720 \
    --user-data-dir="$TEMP_DIR/profile-$SCENE" \
    --screenshot="$TEMP_DIR/scene-$SCENE.png" \
    "file://$HTML_PATH?scene=$SCENE" >/dev/null 2>&1
done

FILTER_COMPLEX=""
for SCENE in 0 1 2; do
  FILTER_COMPLEX="${FILTER_COMPLEX}[${SCENE}:v]fade=t=in:st=0:d=0.25,fade=t=out:st=6.75:d=0.25,setpts=PTS-STARTPTS[v${SCENE}];"
done
FILTER_COMPLEX="${FILTER_COMPLEX}[v0][v1][v2]concat=n=3:v=1:a=0,format=yuv420p[outv]"

ffmpeg -y \
  -loop 1 -t 7 -i "$TEMP_DIR/scene-0.png" \
  -loop 1 -t 7 -i "$TEMP_DIR/scene-1.png" \
  -loop 1 -t 7 -i "$TEMP_DIR/scene-2.png" \
  -filter_complex "$FILTER_COMPLEX" \
  -map "[outv]" -an -c:v libx264 -crf 20 -preset medium -movflags +faststart "$OUTPUT_PATH"

echo "Vídeo creado en $OUTPUT_PATH"
