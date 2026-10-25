#!/bin/bash
# Builds the macOS Computer Use helper as one universal binary (Apple silicon + Intel), ad-hoc signed.
# Run on a Mac with the Xcode command line tools; the release and test workflows run it before packaging.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=src/main/computer/mac/helper.swift
OUT=build/mac
mkdir -p "$OUT"
for arch in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -target "$arch-apple-macos11" -o "$OUT/fabro-cu-$arch" "$SRC"
done
lipo -create -output "$OUT/fabro-cu" "$OUT/fabro-cu-arm64" "$OUT/fabro-cu-x86_64"
rm -f "$OUT/fabro-cu-arm64" "$OUT/fabro-cu-x86_64"
codesign --force --sign - "$OUT/fabro-cu"
lipo -info "$OUT/fabro-cu"
