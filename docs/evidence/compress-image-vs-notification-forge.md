# Compress Image vs Notification Forge, alumni-prioritas-chip.png

Measured 2026-10-23. Source: `tests/bench-images/alumni-prioritas-chip.png`, 2440×1530 RGBA, 6,697,576 bytes.

Notification Forge output: produced by the user at
`notification-forge.mrlf-synaptode.workers.dev/image-to-base64` with its defaults, downloaded as a Base64 data URI
and decoded locally to 2,107,376 bytes (palette PNG: `sRGB`, `PLTE` 192 entries, `tRNS`). The Base64 text is 4/3 of
the file size (2.81 MB); Base64 itself compresses nothing.

Ours: the same libimagequant (speed 4, default dithering) and Oxipng level 2 that the worker uses, run in Node on
the decoded pixels. Error is measured on RGB composited over white, as a viewer sees it. "Bad px" counts pixels
whose summed RGB error exceeds 30.

| Output                     | Bytes     | Colors | PSNR     | Mean error | Max error | Bad px |
| -------------------------- | --------- | ------ | -------- | ---------- | --------- | ------ |
| Notification Forge         | 2,107,376 | 192    | 36.86 dB | 2.40       | 149       | 33,235 |
| Ours, Balanced (target 95) | 2,268,000 | 256    | 39.93 dB | 1.42       | 72        | 8,998  |
| Ours, 192 colors           | 2,124,000 | 192    | 38.85 dB | 1.61       | 75        | 17,041 |
| Ours, Smaller File (t85)   | 1,970,000 | 152    | 38.17 dB | 1.77       | 91        | 24,673 |
| Ours, 128 colors           | 1,874,000 | 128    | 37.37 dB | 1.89       | 96        | 37,672 |

At the same 192 colors, ours is 0.8% larger with half the bad pixels and 2 dB higher PSNR. Smaller File is 6.5%
smaller than Notification Forge and better on every measure. Oxipng level 2 would shrink the Notification Forge
file itself by another 4.8% (to 2,005,692 bytes).

Crop: `compress-image-vs-notification-forge-crop.png` shows Notification Forge's worst 120 px region
(x 480, y 1240) at 3× zoom: original, Notification Forge, ours at 192 colors, ours on Smaller File.

Reproduce: decode the data URI, then score each file against the source with the same composite-over-white PSNR,
mean absolute error per channel, max channel error and summed-error > 30 count.
