# Lockey Table Parsing: Colspan/Rowspan Handling

## Overview

This document describes the HTML table parsing logic in the Master Lockey tool, specifically how it handles `colspan` and `rowspan` attributes when extracting localization keys from Confluence tables.

**Related Files:**
- `frontend/tools/master-lockey/service.js` - `parseConfluenceTableForLockeys()` (lines 360-560)
- `frontend/tools/master-lockey/service.js` - `extractFromNestedTable()` (lines 586-696)

---

## Problem Statement

Confluence tables often use complex structures with `colspan` and `rowspan` attributes. The parser needs to correctly identify which physical cell corresponds to the "Localization Key" column, even when:

1. Header cells span multiple columns (`colspan`)
2. Data cells span multiple columns (`colspan`)
3. Cells span multiple rows (`rowspan`)
4. Combinations of the above

### Example Problem Case

```
Header:   Element (colspan=3)  | Type | Localization Key | Description
          logical: 0  1  2     |  3   |       4          |     5

Data Row: <td colspan="2">Val</td> | Sub | Label | myLockeyKey | Display...
          physical:    0           |  1  |   2   |      3      |     4
          logical:   0   1         |  2  |   3   |      4      |     5
```

**Bug (before fix):** Code used `cells[4]` directly, getting "Display..." instead of "myLockeyKey".

**Fix:** Map logical column 4 to physical cell 3 by accounting for colspan.

---

## Algorithm

### Phase 1: Header Parsing

1. Query all `<th>` cells in the first row
2. Track `logicalIndex` for each header, incrementing by `colspan`
3. Find the header matching "Localization Key" (or variants)
4. Store `lockeyColIndex` as the logical column index

```javascript
// Header parsing (simplified)
let logicalIndex = 0;
headerCells.forEach((header) => {
  const colspan = parseInt(header.getAttribute("colspan") || "1", 10);
  headers.push({ text: header.textContent, logicalIndex, colspan });
  logicalIndex += colspan;
});
```

### Phase 2: Data Row Parsing

For each data row:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Step 1: Build rowspan occupied columns set                          │
│                                                                     │
│ Check rowspanState[] array to find logical columns "blocked" by     │
│ cells from PREVIOUS rows with rowspan > 1.                          │
│                                                                     │
│ const rowspanOccupiedCols = new Set();                              │
│ for (col = 0; col < totalLogicalCols; col++) {                      │
│   if (rowspanState[col] > 0) {                                      │
│     rowspanOccupiedCols.add(col);                                   │
│     rowspanState[col]--;                                            │
│   }                                                                 │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 2: Iterate physical cells, track logical position              │
│                                                                     │
│ let logicalCol = 0;                                                 │
│ let targetPhysicalCellIndex = -1;                                   │
│                                                                     │
│ for (physicalIdx = 0; physicalIdx < cells.length; physicalIdx++) {  │
│   // Skip columns occupied by rowspans                              │
│   while (rowspanOccupiedCols.has(logicalCol)) {                     │
│     logicalCol++;                                                   │
│   }                                                                 │
│                                                                     │
│   const colspan = cell.getAttribute("colspan") || 1;                │
│   const rowspan = cell.getAttribute("rowspan") || 1;                │
│                                                                     │
│   // Check if this cell contains the target logical column          │
│   if (logicalCol <= lockeyColIndex < logicalCol + colspan) {        │
│     targetPhysicalCellIndex = physicalIdx;                          │
│   }                                                                 │
│                                                                     │
│   // Update rowspan state for future rows                           │
│   if (rowspan > 1) {                                                │
│     for (c = logicalCol; c < logicalCol + colspan; c++) {           │
│       rowspanState[c] = rowspan - 1;                                │
│     }                                                               │
│   }                                                                 │
│                                                                     │
│   logicalCol += colspan;                                            │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 3: Extract lockey from cells[targetPhysicalCellIndex]          │
└─────────────────────────────────────────────────────────────────────┘
```

### Visual Trace Example

**Scenario:** Row with colspan=2 on first cell, rowspan from previous row

```
Row 1: <td rowspan="2">A</td> <td>B</td> <td>C</td> <td>LOCKEY1</td>
       logical: 0              1         2         3

Row 2: (A continues)          <td colspan="2">D</td>  <td>LOCKEY2</td>
       physical:              0                       1
       logical: (0 blocked)   1         2             3
```

**Trace for Row 2:**
- `rowspanOccupiedCols = {0}` (from Row 1's cell A)
- Physical cell 0 ("D"): logicalCol starts at 0, skips to 1, colspan=2 covers 1-2
- Physical cell 1 ("LOCKEY2"): logicalCol = 3
- `lockeyColIndex = 3` matches → `targetPhysicalCellIndex = 1`
- Result: `cells[1]` = "LOCKEY2" ✓

---

## Known Edge Cases & Limitations

### 1. Header Cells with Rowspan (NOT HANDLED)

**Scenario:** Header cell extends into data rows.

```html
<tr>
  <th rowspan="2">Element</th>  <!-- Extends into next row -->
  <th>Type</th>
  <th>Localization Key</th>
</tr>
<tr>
  <!-- Element continues here, not a data row -->
  <td>Label</td>           <!-- Physical 0, should be logical 1 -->
  <td>myLockeyKey</td>     <!-- Physical 1, should be logical 2 -->
</tr>
```

**Current Behavior:** `rowspanState` is initialized to zeros. Header rowspans are not tracked, causing miscalculation in subsequent rows.

**Impact:** Low likelihood in typical Confluence tables.

**Potential Fix:**
```javascript
// Before processing data rows, scan header for rowspans
headerCells.forEach((header, idx) => {
  const rowspan = parseInt(header.getAttribute("rowspan") || "1", 10);
  if (rowspan > 1) {
    rowspanState[headers[idx].logicalIndex] = rowspan - 1;
  }
});
```

---

### 2. Lockey Header with Colspan (NOT HANDLED)

**Scenario:** "Localization Key" header spans multiple columns.

```html
<tr>
  <th>Element</th>
  <th colspan="2">Localization Key</th>  <!-- Spans logical 1-2 -->
  <th>Description</th>
</tr>
<tr>
  <td>Button</td>
  <td>primaryKey</td>      <!-- logical 1 - found -->
  <td>secondaryKey</td>    <!-- logical 2 - MISSED -->
  <td>Display text</td>
</tr>
```

**Current Behavior:** Only checks `lockeyColIndex = 1`. Keys at logical column 2 are missed.

**Impact:** Low likelihood; most tables have single-column lockey headers.

**Potential Fix:**
```javascript
// Store lockey header's colspan
const lockeyColspan = matchedHeader.colspan || 1;

// When checking cells, match any column in the lockey range
if (logicalCol <= lockeyColIndex + lockeyColspan - 1 &&
    logicalCol + colspan > lockeyColIndex) {
  // This cell overlaps with lockey column range
}
```

---

### 3. Data Cell Spanning Across Lockey Column (PARTIALLY HANDLED)

**Scenario:** A data cell spans multiple columns including the lockey column.

```html
<tr>
  <th>A</th>
  <th>B</th>
  <th>Localization Key</th>  <!-- logical 2 -->
  <th>D</th>
</tr>
<tr>
  <td colspan="3">This spans A, B, and Lockey</td>  <!-- Contains logical 2 -->
  <td>Value</td>
</tr>
```

**Current Behavior:** Cell is selected, but content "This spans A, B, and Lockey" fails camelCase validation.

**Impact:** Very low; indicates malformed table structure.

**Mitigation:** The `isStandaloneCamelCase()` validation rejects non-lockey content.

---

### 4. Nested Tables with Complex Structure (HANDLED)

**Scenario:** Cell contains a nested table that also has colspan/rowspan.

**Current Behavior:** `extractFromNestedTable()` now uses the same colspan-aware algorithm as the main parser:
- Header colspan is tracked via `logicalIndex`
- Data cell colspan is handled by mapping logical column to physical cell

**Status:** Fixed in the same update as the main parser.

---

## Summary

| Edge Case | Status | Impact | Likelihood |
|-----------|--------|--------|------------|
| Data cell colspan | ✅ Fixed | High | High |
| Data cell rowspan | ✅ Fixed | High | Medium |
| Combined colspan + rowspan | ✅ Fixed | High | Medium |
| Nested table colspan | ✅ Fixed | Medium | Medium |
| Header rowspan into data | ❌ Not handled | Medium | Low |
| Lockey header colspan | ❌ Not handled | Low | Low |
| Data cell spans lockey | ⚠️ Mitigated by validation | Low | Very Low |

---

## Testing

To verify the fix, use the browser console logs when parsing a Confluence page:

```
[Parse] Row 14: targetLogical=4, targetPhysical=3, rowspanCols=[0,1] (cells: 6)
[Parse] Found camelCase key: autoDebitBillDetailPaidLabel (status: plain)
```

Key log fields:
- `targetLogical`: The lockey column's logical index (from header)
- `targetPhysical`: The calculated physical cell index
- `rowspanCols`: Logical columns blocked by previous rowspans
- `cells`: Number of physical `<td>` elements in the row

---

## References

- Original bug: `autoDebitBillDetailPaidLabel` not parsed due to `colspan="2"` in preceding cell
- Fix commit: See `service.js` lines 448-499
- Test log: `docs/parse_log.txt`
