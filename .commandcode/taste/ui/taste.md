# ui
- For multi-pane tools, make panes collapsible and width-adjustable by the user. Confidence: 0.70
- Use icon buttons instead of text buttons for clear and copy actions in tool toolbars. Confidence: 0.70
- Wants visual and structural consistency within a toolbar: when adding a new control, reuse the existing pattern's markup/styling for that control type ("apply the previous style") rather than introducing a new look. Confidence: 0.6
- Prefer plain standalone buttons over collapsed dropdown/popover menus for a small set of related actions; each button carries its own icon. Confidence: 0.65
- Prefer a single "Save" action that always prompts the user for the destination filename, rather than separate "Save" (silent default-named download) and "Save As" buttons. Confidence: 0.6
- When changing UI colors/accents, explicitly check what accent to use for each theme and verify the result across all supported themes (app has ~19 data-theme variants) rather than just the currently active one; pick accent tokens that stay visible in every theme. Confidence: 0.7
- UI state indicators (checked vs. unchecked, selected vs. unselected) must be clearly, visibly distinct — flags muted or washed-out states as a defect ("too muted, can't see the difference"). Confidence: 0.6
- Reports UI issues by pasting a screenshot with a terse comment on what looks wrong; expects the agent to visually analyze the image before changing code. Confidence: 0.6
