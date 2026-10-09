# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# analytics
- Avoid double-counting analytics events. Tabs reporting unique actions must not count the same event under multiple categories; each event should map to exactly one action type. Confidence: 0.80

# tauri
- Use Tauri native file selection dialog instead of browser-based upload mechanism for file picking. Confidence: 0.70

# ui
- For multi-pane tools, make panes collapsible and width-adjustable by the user. Confidence: 0.70
- Use icon buttons instead of text buttons for clear and copy actions in tool toolbars. Confidence: 0.70
- Wants visual and structural consistency within a toolbar: when adding a new control, reuse the existing pattern's markup/styling for that control type ("apply the previous style") rather than introducing a new look. Confidence: 0.6
- Prefer plain standalone buttons over collapsed dropdown/popover menus for a small set of related actions; each button carries its own icon. Confidence: 0.65
- Prefer a single "Save" action that always prompts the user for the destination filename, rather than separate "Save" (silent default-named download) and "Save As" buttons. Confidence: 0.6

# html-minification
- Keep closing slashes and closing tags when minifying HTML; do not use minification that removes closing tags as it breaks legacy HTML processors. Confidence: 0.70
- Remove fallback behavior for html-minifier: if the package is unavailable, fail with a clear error message instead of silently falling back to an unsafe minification path. Confidence: 0.70
