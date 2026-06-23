# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# analytics
- Avoid double-counting analytics events. Tabs reporting unique actions must not count the same event under multiple categories; each event should map to exactly one action type. Confidence: 0.80

# tauri
- Use Tauri native file selection dialog instead of browser-based upload mechanism for file picking. Confidence: 0.70

# ui
- For multi-pane tools, make panes collapsible and width-adjustable by the user. Confidence: 0.70
- Use icon buttons instead of text buttons for clear and copy actions in tool toolbars. Confidence: 0.70

# velocity-template
- Color highlight JSON content embedded inside Velocity templates using the same styling as normal JSON syntax highlighting. Confidence: 0.75
- For Velocity Template tool layout: order panes as JSON Payload Input (top), Template Input (middle), Result (bottom). Confidence: 0.70

# html-minification
- Keep closing slashes and closing tags when minifying HTML; do not use minification that removes closing tags as it breaks legacy HTML processors. Confidence: 0.70
- Remove fallback behavior for html-minifier: if the package is unavailable, fail with a clear error message instead of silently falling back to an unsafe minification path. Confidence: 0.70
