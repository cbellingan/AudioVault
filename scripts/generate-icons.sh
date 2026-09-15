#!/usr/bin/env bash
set -e

SRC_IMG="/Users/cb/.gemini/antigravity/brain/a081ffc0-dd54-40a5-889a-78a324ebdb03/audiovault_app_icon_1789507110111.jpg"
BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/build"
ICONSET_DIR="${BUILD_DIR}/icon.iconset"

mkdir -p "${ICONSET_DIR}"

echo "🎨 Converting source image to standard macOS icon sizes..."

# Convert source JPEG to high-res master PNG
sips -s format png "${SRC_IMG}" --out "${BUILD_DIR}/icon.png" > /dev/null

# Generate Apple iconset resolutions
sips -z 16 16     "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_16x16.png" > /dev/null
sips -z 32 32     "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_16x16@2x.png" > /dev/null
sips -z 32 32     "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_32x32.png" > /dev/null
sips -z 64 64     "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_32x32@2x.png" > /dev/null
sips -z 128 128   "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_128x128.png" > /dev/null
sips -z 256 256   "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_128x128@2x.png" > /dev/null
sips -z 256 256   "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_256x256.png" > /dev/null
sips -z 512 512   "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_256x256@2x.png" > /dev/null
sips -z 512 512   "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_512x512.png" > /dev/null
sips -z 1024 1024 "${BUILD_DIR}/icon.png" --out "${ICONSET_DIR}/icon_512x512@2x.png" > /dev/null

echo "📦 Packaging iconset into Apple .icns bundle with iconutil..."
iconutil -c icns "${ICONSET_DIR}" -o "${BUILD_DIR}/icon.icns"

rm -rf "${ICONSET_DIR}"
echo "✅ Successfully generated: ${BUILD_DIR}/icon.icns and ${BUILD_DIR}/icon.png"
