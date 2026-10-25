# Cached preview round-trip verification

Verified locally on 2026-10-25 in the browser and an isolated, packaged Tauri debug application.

## Change

The workspace now persists ArrayBuffer contents for the original, selected result, and both variants.
It rebuilds memory-backed File/Blob objects before the UI generates preview URLs. Previously it
persisted browser-managed File/Blob objects directly and restored their metadata without materializing
the contents. Readable records in that older format are hydrated eagerly and saved in the new format
on the next write. A failed save does not prevent reading the last successful snapshot.

This removes the cache's dependency on the lifetime of IndexedDB Blob backing files. It cannot
reconstruct bytes that were already lost. The exact original failure was not reproduced reliably;
the new checks cover the missing multi-row decode assertions and the durable-byte storage contract.

## Reproduce in the browser

```sh
./node_modules/.bin/vite --port 1235
```

Open [the large-image test](http://localhost:1235/tools/compress-image/tests/cache-preview-roundtrip.html?large).
The harness uses a disposable workspace and generates three distinct 2440 × 1530 PNGs, each around
7 MB. It uses the real Quick Query tools, codecs, workers, IndexedDB, image elements and decode().
Only the first image is previewed before leaving Compress Image, matching the reported scenario.

It exercises QQ → Compress → QQ, deletes the three source attachments, then sends the returned
compressed images back with **Add to existing**. It verifies all six rows, both variants for the
three cached rows, a second restore after attachment deletion, and original-byte readability.

- [Browser report](./cache-preview-browser-result.json): 36 checks passed.
- [Legacy cache report](./cache-lifecycle-result.json): previous Blob records and 12 repeated overwrites.

## Reproduce in native Tauri

```sh
node frontend/tools/compress-image/tests/build-desktop-verification.mjs --cache-preview
```

The build uses installed dependencies with Cargo offline, and creates an unsigned debug app at
`tauri/target/debug/bundle/macos/AD Tools Image Optimizer Verification.app`.
Open that app. Its identifier is `com.adtools.imageoptimizer.verify`, separate from the working app's
`com.adtools.desktop`, so the harness does not clear or modify the user's normal workspace.
The default verification command without `--cache-preview` still opens the codec browser harness.

The native test passed with three 2440 × 1530 PNGs of 6,628,207 / 6,628,459 / 6,628,510 bytes.
Each retained lossless and lossy results. Both original and compressed image elements decoded after
the round trip and after another restore. Rows two and three were then selected manually:

- [Native row-two preview](./cache-preview-native-row2.png).
- [Native row-three preview](./cache-preview-native-row3.png).
- [Native accessibility evidence](./cache-preview-native-state.txt), including the PASS status.

The existing targeted scope also passed: 40 Vitest files, 453 tests. The production app, workers,
WASM and native verification entry built successfully as part of the offline Tauri debug build.
