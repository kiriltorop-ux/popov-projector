#!/bin/zsh
set -eu
cd "${0:A:h}"
app="../Пульт Попова.app/Contents"
mkdir -p "$app/MacOS"
swiftc -O -module-cache-path "${TMPDIR:-/tmp}/popov-swift-cache" main.swift Avatar.swift StreamAudio.swift FrameExport.swift -framework AppKit -framework SpriteKit -framework AVFoundation -o "$app/MacOS/Projector"
cp Info.plist "$app/Info.plist"
codesign --force --sign - "../Пульт Попова.app"
