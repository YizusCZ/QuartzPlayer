#!/usr/bin/env bash
# Builds native/quartz-core for Android and leaves the library where Gradle
# packs it. Only needed after changing the Rust code: the .so stays in the repo.
#
#   rustup target add aarch64-linux-android     (once)
#   scripts/build-rust.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
NDK="$(ls -d "$SDK"/ndk/* | sort -V | tail -1)"
BIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$BIN/aarch64-linux-android24-clang"
# 16 KB pages: required for apps on recent Android versions.
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384"
export CC_aarch64_linux_android="$BIN/aarch64-linux-android24-clang"
nice -n 10 cargo build --manifest-path native/quartz-core/Cargo.toml --release --lib --jobs 2 --target aarch64-linux-android
OUT=modules/quartz-core/android/src/main/jniLibs/arm64-v8a
mkdir -p "$OUT"
cp native/quartz-core/target/aarch64-linux-android/release/libquartz_core.so "$OUT/"
ls -la "$OUT/libquartz_core.so"
