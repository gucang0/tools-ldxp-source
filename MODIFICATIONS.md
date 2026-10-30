# Noncommercial Customization

This repository customizes Cockpit Tools for personal and noncommercial sharing.

- Original project: https://github.com/jlcodes99/cockpit-tools
- Original author: jlcodes99
- License: https://creativecommons.org/licenses/by-nc-sa/4.0/
- Modified source: https://github.com/gucang0/tools-ldxp-source
- Update releases: https://github.com/gucang0/tools/releases

## Changes

- Top promotional content is disabled.
- The top promotion area is empty and old promotion caches are ignored.
- Signed application updates use the noncommercial build's release repository.
- Windows x64 and macOS Universal packages are built by a guarded workflow.

No commercial use is authorized by this repository.

## Automation maintenance

- Candidates start from the exact official release tree; only allowlisted changes are applied.
- Release-note URLs use scoped, exact-once literal replacements, independent of nearby release highlights or formatting. All other upstream content and trailing whitespace are preserved.
- Missing, duplicated or overlapping targets fail closed and require maintenance. Runtime patches still require a clean application; unsafe fuzzy application and old-file copying are not used.
- The detector runs candidate/sync regression tests before preparing or dispatching a release. Full build, signature, manifest and publication gates remain required.
- Go setup and legacy sidecar package checks follow the validated Tauri configuration and source files. Native-only releases do not require the removed sidecar; inconsistent or unknown binary layouts fail before building.
