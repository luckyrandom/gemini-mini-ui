#!/usr/bin/env bash
#
# Refresh the vendored @google/gemini-cli-sdk sources.
#
# By default, downloads a source tarball from github.com/google-gemini/gemini-cli.
# A branch name, tag, or commit SHA may be passed; it's resolved to a pinned SHA
# (via `git ls-remote`) before the tarball is fetched, so VERSION.txt records
# exactly what was vendored.
#
# Usage:
#   scripts/vendor-sdk.sh                      # latest main from GitHub
#   scripts/vendor-sdk.sh v0.38.2              # a tag
#   scripts/vendor-sdk.sh 8573650253           # a commit SHA (prefix or full)
#   scripts/vendor-sdk.sh --local ../gemini-cli    # use a local checkout instead
#   GEMINI_CLI_REPO=/abs/path scripts/vendor-sdk.sh --local
#
# After running, bump @google/gemini-cli-core in package.json so the core
# runtime matches the SDK snapshot (the script prints the core version as a
# reminder).

set -euo pipefail

GH_OWNER="google-gemini"
GH_REPO="gemini-cli"
GH_URL="https://github.com/$GH_OWNER/$GH_REPO"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest_dir="$repo_root/server/vendor/gemini-cli-sdk"

mode="remote"
ref="main"
local_path="${GEMINI_CLI_REPO:-$repo_root/../gemini-cli}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      mode="local"
      if [[ $# -ge 2 && "$2" != --* ]]; then
        local_path="$2"
        shift
      fi
      ;;
    -h|--help)
      sed -n '3,19p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      ref="$1"
      ;;
  esac
  shift
done

copy_from_dir() {
  local src_dir="$1"
  mkdir -p "$dest_dir"
  find "$dest_dir" -maxdepth 1 -type f -name '*.ts' -delete

  local restore_nullglob
  restore_nullglob="$(shopt -p nullglob)"
  shopt -s nullglob
  local copied=0
  for f in "$src_dir"/*.ts; do
    local base
    base="$(basename "$f")"
    case "$base" in
      *.test.ts|*.integration.test.ts) continue ;;
    esac
    cp "$f" "$dest_dir/$base"
    copied=$((copied + 1))
  done
  eval "$restore_nullglob"

  if [[ $copied -eq 0 ]]; then
    echo "error: no .ts files copied from $src_dir" >&2
    exit 1
  fi
  echo "$copied"
}

read_pkg_version() {
  # $1 = path to package.json
  node -p "require('$1').version" 2>/dev/null || echo "unknown"
}

write_version_file() {
  local source_desc="$1" commit="$2" sdk_version="$3" core_version="$4"
  cat >"$dest_dir/VERSION.txt" <<EOF
source: $source_desc
commit: $commit
sdk:    $sdk_version
core:   $core_version
copied: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

if [[ "$mode" == "local" ]]; then
  src_repo="$local_path"
  src_dir="$src_repo/packages/sdk/src"

  if [[ ! -d "$src_dir" ]]; then
    echo "error: $src_dir does not exist" >&2
    exit 1
  fi
  if [[ ! -d "$src_repo/.git" ]]; then
    echo "error: $src_repo is not a git checkout" >&2
    exit 1
  fi

  commit="$(git -C "$src_repo" rev-parse HEAD)"
  if ! git -C "$src_repo" diff --quiet || ! git -C "$src_repo" diff --cached --quiet; then
    commit="$commit (dirty working tree)"
  fi

  sdk_version="$(read_pkg_version "$src_repo/packages/sdk/package.json")"
  core_version="$(read_pkg_version "$src_repo/packages/core/package.json")"

  copied="$(copy_from_dir "$src_dir")"
  write_version_file "local: $src_repo" "$commit" "$sdk_version" "$core_version"

  echo "vendored $copied files from $src_dir"
else
  # Remote mode: resolve ref → SHA, download tarball, extract.
  if [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]]; then
    sha="$ref"
  else
    echo "resolving $ref on $GH_URL..."
    # ls-remote returns "<sha>\t<refname>" — try branch first, then tag.
    resolved="$(git ls-remote "$GH_URL" "refs/heads/$ref" "refs/tags/$ref" 2>/dev/null | head -n1 | awk '{print $1}')"
    if [[ -z "$resolved" ]]; then
      echo "error: could not resolve ref '$ref' as a branch, tag, or SHA" >&2
      exit 1
    fi
    sha="$resolved"
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  tarball_url="https://codeload.github.com/$GH_OWNER/$GH_REPO/tar.gz/$sha"
  echo "downloading $tarball_url"
  curl -fSL "$tarball_url" -o "$tmp/src.tar.gz"

  # Extract only the SDK src and the two package.json files we need.
  # --strip-components=1 removes the top-level "gemini-cli-<sha>/" prefix.
  tar -xzf "$tmp/src.tar.gz" -C "$tmp" --strip-components=1 \
    "$GH_REPO-$sha/packages/sdk/src" \
    "$GH_REPO-$sha/packages/sdk/package.json" \
    "$GH_REPO-$sha/packages/core/package.json"

  sdk_version="$(read_pkg_version "$tmp/packages/sdk/package.json")"
  core_version="$(read_pkg_version "$tmp/packages/core/package.json")"

  copied="$(copy_from_dir "$tmp/packages/sdk/src")"
  write_version_file "$GH_URL@$ref" "$sha" "$sdk_version" "$core_version"

  echo "vendored $copied files from $GH_URL @ $sha"
fi

echo "  sdk:    $sdk_version"
echo "  core:   $core_version"
echo
echo "next: ensure @google/gemini-cli-core in package.json matches core version above"
