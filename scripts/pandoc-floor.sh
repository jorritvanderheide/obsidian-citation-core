#!/usr/bin/env bash
# The filter tests against each pandoc named, to find the oldest that works
# (OLDEST_PANDOC in src/core/built-in.ts):
#
#   scripts/pandoc-floor.sh 3.6.3 3.6.4 3.7
#
# Each comes from pandoc's release on GitHub, as its static Linux build, into
# a temporary folder that goes again afterwards. The expected output is the
# pinned pandoc's, so an older one also fails on formatting: read which tests
# fail, and why, before moving the floor.
set -euo pipefail
cd "$(dirname "$0")/.."
arch=$(uname -m)
case $arch in
	x86_64) arch=amd64 ;;
	aarch64) arch=arm64 ;;
	*) echo "pandoc has no static build for $arch" >&2; exit 1 ;;
esac
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
for version in "$@"; do
	mkdir -p "$dir/$version"
	curl -fsSL "https://github.com/jgm/pandoc/releases/download/$version/pandoc-$version-linux-$arch.tar.gz" | tar -xz -C "$dir/$version" --strip-components=1
	echo "== pandoc $version"
	PATH="$dir/$version/bin:$PATH" PANDOC_OTHER_VERSION=1 npx vitest run tests/pandoc.test.ts 2>&1 | grep -E '^ +(×|Tests )' || true
done
