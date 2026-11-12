# Upstream sync

This repository is the Foundry VTT v12 build of
[Daxiongmao87/simulacrum-foundry](https://github.com/Daxiongmao87/simulacrum-foundry). The
[Sync upstream](../.github/workflows/sync-upstream.yml) workflow keeps it current.

## What runs

Every day at 06:17 UTC, and whenever you start it from **Actions → Sync upstream → Run workflow**:

1. `tools/fork/sync-upstream.sh` fetches the upstream branch named in [`upstream.json`](upstream.json)
   (`main` by default) and applies everything that changed since `syncedCommit` as one patch.
2. The test tiers run (`policy`, `static`, `unit`, `component`, `regression`, `package`, `security`).
3. `module.json` is rebuilt from upstream's copy by `tools/fork/apply-fork-manifest.mjs`, and the version
   is bumped: the higher of the current fork version with its patch number + 1, or the upstream version.
4. The package is built and `tools/fork/publish-release.sh` puts it on the `release` branch, which keeps
   the newest 3 packages. Then the sync commit is pushed to `main`. Foundry sees the new version in the
   manifest and offers the update.

The workflow does nothing when upstream has no new commits.

## Paths the fork owns

These are never patched from upstream:

| Path                 | Why                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `.github/workflows/` | The fork keeps its own workflows. The Actions token cannot push workflow changes anyway.          |
| `module.json`        | Rebuilt from upstream's copy plus the fork overlay (links, v12 minimum, v12 stylesheet, version). |
| `README.md`          | The fork's README. Upstream README changes are not copied.                                        |

All other files, including the v12 compatibility code, are patched with a 3-way merge.

## When it needs you

If the upstream patch conflicts with the fork's changes, or the tests fail, nothing is pushed or
published, the current release keeps working, and an issue labelled `upstream-sync` is opened (or
commented on, if one is already open). To resolve a conflict by hand:

```bash
git checkout main && git pull
bash tools/fork/sync-upstream.sh        # stops with conflict markers in the listed files
# fix the conflicts, then rebuild module.json from upstream's copy with a new version:
node tools/fork/apply-fork-manifest.mjs --upstream <(git show FETCH_HEAD:module.json) \
  --current module.json --out module.json --bump
# set "syncedCommit" in fork/upstream.json to the upstream commit the script printed
git add -A && git commit -m "chore: sync upstream (manual)" && git push
```

Then run the workflow (or wait for the next daily run). Whenever the version in `main`'s `module.json` has
no package on the `release` branch yet, the workflow builds and publishes it. The same applies if you
bump the version by hand after a fork-only change.

To follow upstream releases instead of `main`, set `"ref"` in `upstream.json` to a tag, or pass a ref when
running the workflow by hand.
