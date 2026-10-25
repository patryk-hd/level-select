#!/bin/zsh
set -euo pipefail
RETRO_BUILD_ROOT="${0:A:h:h}"
RETRO_BUILD_APP="$RETRO_BUILD_ROOT/Level Select.app"
RETRO_BUILD_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/retro-library-build.XXXXXX")"
RETRO_BUILD_XCODE="/Applications/Xcode.app/Contents/Developer"
RETRO_BUILD_SWIFTC="$RETRO_BUILD_XCODE/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"
RETRO_BUILD_SDK="$RETRO_BUILD_XCODE/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
trap 'rm -rf "$RETRO_BUILD_TEMP"' EXIT
if [[ ! -x "$RETRO_BUILD_SWIFTC" || ! -d "$RETRO_BUILD_SDK" ]]; then
  RETRO_BUILD_SWIFTC="$(xcrun --find swiftc)"
  RETRO_BUILD_SDK="$(xcrun --show-sdk-path)"
fi
mkdir -p "$RETRO_BUILD_TEMP/app/Contents/MacOS" "$RETRO_BUILD_TEMP/app/Contents/Resources" "$RETRO_BUILD_TEMP/module-cache"
"$RETRO_BUILD_SWIFTC" -swift-version 5 -O -target "$(uname -m)-apple-macos13.0" \
  -sdk "$RETRO_BUILD_SDK" -module-cache-path "$RETRO_BUILD_TEMP/module-cache" -framework AppKit \
  "$RETRO_BUILD_ROOT/launcher/RetroLibrary.swift" -o "$RETRO_BUILD_TEMP/app/Contents/MacOS/RetroLibrary"
"$RETRO_BUILD_SWIFTC" -swift-version 5 -sdk "$RETRO_BUILD_SDK" -module-cache-path "$RETRO_BUILD_TEMP/module-cache" -framework AppKit \
  "$RETRO_BUILD_ROOT/launcher/RetroIcon.swift" -o "$RETRO_BUILD_TEMP/icon-generator"
"$RETRO_BUILD_TEMP/icon-generator" "$RETRO_BUILD_TEMP/app/Contents/Resources/RetroLibrary.icns"
cp "$RETRO_BUILD_ROOT/launcher/Info.plist" "$RETRO_BUILD_TEMP/app/Contents/Info.plist"
print -r -- "$RETRO_BUILD_ROOT" > "$RETRO_BUILD_TEMP/app/Contents/Resources/project-path.txt"
codesign --force --deep --sign - "$RETRO_BUILD_TEMP/app" >/dev/null
mkdir -p "$RETRO_BUILD_APP"
ditto "$RETRO_BUILD_TEMP/app" "$RETRO_BUILD_APP"
echo "Built $RETRO_BUILD_APP"
