## Default state

Show all sections expanded:

- **Upper left:** Query Configuration
- **Bottom left:** Export Configuration / Generated Files
- **Right:** Preview

This is best for first entry and first-time setup.

---

## After successful query

Allow the **Query Configuration** panel to collapse.

When collapsed, it should shrink into a compact summary bar like:

- Environment: `UAT 3 Comp`
- Saved Query: `Gold Loan Content`
- Result: `4 rows · 3 columns · 335 ms`
- Actions:
  - **Expand**
  - **Run Again** / **Edit Query**

That way users do **not lose context**, but they gain more space for the parts they are actively working with.

---

# Why this is good

Because the workflow becomes:

```text
Set query
→ Run query
→ Collapse query setup
→ Focus on export configuration
→ Select generated files
→ Inspect preview
```

That is much better than permanently forcing the SQL editor to consume space even when it is no longer the current focus.

---

# Best collapse pattern

I would recommend:

## Expanded

Large SQL editor and full query controls visible.

## Collapsed

A compact header/card, something like:

```text
Query Configuration
UAT 3 Comp · Gold Loan Content · 4 rows · 335 ms
[Expand] [Run Again]
```

This is better than hiding it completely.

---

# Important rule

The collapse should happen **only for the Query Configuration section**, not the whole left column.

So the left side becomes:

```text
┌──────────────────────┐
│ Query Configuration  │   ← collapsible
├──────────────────────┤
│ Export Configuration │   ← always visible
│ Generated Files      │
└──────────────────────┘
```

That is the right balance.

If you collapse the whole left side, users lose navigation and file selection, which would hurt usability.

---

# Even better behavior

## Auto-suggest collapse after success

After query succeeds, you can optionally show a small inline affordance:

- “Query completed successfully”
- “Collapse query setup to focus on output”

But I would **not auto-collapse immediately**, because users may still want to inspect or tweak the SQL right away.

So:

- **manual collapse by default**
- maybe remember the user’s preference afterward

---

# What the collapsed mode helps most with

It gives more space to:

- generated file list
- filename/content configuration
- right-side preview
- rendered HTML reading
- raw HTML/source inspection

This is especially valuable when previewing long legal or template documents.

---

# My recommendation

Yes, implement it like this:

- **Upper-left Query Configuration = collapsible**
- **Bottom-left Export Configuration / Generated Files = persistent**
- **Right Preview = always large**
- **Collapsed query state = compact summary + quick actions**

So the experience supports both modes:

## Authoring mode

Query area expanded.

## Review mode

Query area collapsed, focus on files and preview.

That is a very sensible interaction model.
