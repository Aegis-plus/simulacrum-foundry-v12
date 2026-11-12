#!/usr/bin/env bash
# Publish a built package to the `release` branch, which Foundry downloads from
# (module.json "download" -> raw.githubusercontent.com/.../release/<zip>).
#
# The branch is rebuilt as a single commit on every publish, keeping the newest
# $KEEP packages, so repeated releases do not grow the repository history.
#
# Usage: tools/fork/publish-release.sh <zip> <version> [upstream-commit]
set -euo pipefail

ZIP=$1
VERSION=$2
UPSTREAM=${3:-}
KEEP=${KEEP:-3}
REMOTE=${REMOTE:-origin}
BRANCH=${BRANCH:-release}
REPO_RAW="https://raw.githubusercontent.com/Aegis-plus/simulacrum-foundry-v12"

[ -f "$ZIP" ] || { echo "Package not found: $ZIP" >&2; exit 1; }

STAGE=$(mktemp -d)
WT=$(mktemp -d)
cleanup() { git worktree remove --force "$WT" 2>/dev/null || true; rm -rf "$STAGE" "$WT"; }
trap cleanup EXIT

# Collect the packages already published.
if git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null; then
  for f in $(git ls-tree --name-only FETCH_HEAD | grep -E '\.zip$' || true); do
    git show "FETCH_HEAD:$f" > "$STAGE/$f"
  done
fi
cp "$ZIP" "$STAGE/$(basename "$ZIP")"

# Keep the newest $KEEP packages by version.
mapfile -t ZIPS < <(ls "$STAGE"/*.zip | xargs -n1 basename | sort -V -r | head -n "$KEEP")

rm -rf "$WT"
git worktree add --quiet --detach "$WT"
(
  cd "$WT"
  git checkout --quiet --orphan "publish-$BRANCH-$$"
  git rm -rq --cached . > /dev/null 2>&1 || true
  find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  for z in "${ZIPS[@]}"; do cp "$STAGE/$z" .; done
  cp "$OLDPWD/module.json" module.json
  {
    echo "# Release packages"
    echo
    echo "Built packages for the Foundry VTT v12 build of Simulacrum. Source is on [\`main\`](https://github.com/Aegis-plus/simulacrum-foundry-v12/tree/main)."
    echo "This branch is rebuilt automatically on every release and keeps the newest $KEEP packages."
    echo
    echo "Install in Foundry with this manifest URL:"
    echo
    echo '```'
    echo "$REPO_RAW/main/module.json"
    echo '```'
    echo
    echo "| Package |"
    echo "| --- |"
    for z in "${ZIPS[@]}"; do echo "| [$z]($z) |"; done
    echo
    echo "\`module.json\` here is a copy of the manifest the newest package was built from."
  } > README.md
  git add -A
  MSG="release: simulacrum $VERSION (Foundry v12 build)"
  [ -n "$UPSTREAM" ] && MSG="$MSG

Upstream: Daxiongmao87/simulacrum-foundry@$UPSTREAM"
  git commit --quiet -m "$MSG"
  git push --quiet --force "$REMOTE" "HEAD:refs/heads/$BRANCH"
  git checkout --quiet --detach
  git branch -D --quiet "publish-$BRANCH-$$"
)
echo "Published $(basename "$ZIP") to $BRANCH (keeping: ${ZIPS[*]})."
