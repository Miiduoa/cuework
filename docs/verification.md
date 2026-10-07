# Verification

## Executed on 2026-10-07

15 automated tests cover subtitle parsing/round trips, nested overlaps, atomic offsets, input bounds, SQLite restart persistence, competing writers, restore history, HTTP Host/Origin/content-type rejection, and the IndexedDB adapter. Strict TypeScript and both production/Pages builds pass locally.

The following Chromium UI checks were executed against the SQLite API through the documented Vite development proxy:

- Changed the document title and first cue start to 2,125 ms, then used Cmd+S while the timestamp field retained focus. The second window loaded the exact title and time from SQLite.
- Opened two windows at revision 1. The first saved revision 2; the second received a conflict. Its separate draft remained visible and could be exported.
- Exported that conflicting draft as SRT and parsed the downloaded file independently. The 2,125 ms time, Chinese text, newlines and literal HTML text were retained. HTML text did not execute in the interface.
- Restored revision 1. The API retained revisions 1 and 2 and appended revision 3 with the restored content.
- Applied an offset that would create a negative start time. The operation was rejected and the original time remained unchanged.

Browser mode was checked separately: a manual IndexedDB save survived a full reload, and its interface identified storage as browser-local. At 390px, document width matched the viewport. Desktop and mobile screenshots were inspected.

## Limits of this run

The browser extension did not permit automated file-chooser access. Actual SRT/VTT file-picker import and local-video attachment were not browser-verified. Parsing, whole-file rejection and export round trips are tested independently. The browser tool also blocked direct navigation to the production port; HTTP tests and curl exercised that server, while interactive SQLite UI checks used its documented development proxy.

Safari, Firefox, screen-reader behavior, browser eviction/quota failure and large-video playback remain manual follow-up checks. No production-hosted SQLite backend or cloud synchronization is claimed.
