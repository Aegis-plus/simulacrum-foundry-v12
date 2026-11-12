# Changelog (Foundry VTT v12 build)

Changes specific to this fork. Upstream changes are listed in [CHANGELOG.md](CHANGELOG.md);
the automatic upstream sync brings them in (see [fork/README.md](fork/README.md)).

## [1.1.2] - 2026-11-12

### Fixed

- The "Grunk Benchmark" macro in the Simulacrum Tools compendium had `author: "simulacrum"`, which is not a valid user ID, so Foundry logged `author: must be a valid 16-character alphanumeric ID` when loading the compendium. The author is now unset (`null`).

### Changed

- The upstream sync rebuilds the compendium from `packs/_source` instead of patching the binary LevelDB files.

## [1.1.1] - 2026-11-12

### Fixed

- v12: the model selector collapsed to a few pixels and the context-limit box overflowed the sidebar, because v12 core's `input[type="text"]` rule overrode the module's input sizing. Both inputs are now sized explicitly in the v12 stylesheet.

## [1.1.0] - 2026-11-12

### Added

- Foundry VTT v12 support: compatibility sidebar tab built on v12 ApplicationV2, v12 tab button and pop-out, version shims for `renderTemplate`/`loadTemplates`/`buildUuid`, and a v12-only stylesheet. `compatibility.minimum` lowered to 12.
