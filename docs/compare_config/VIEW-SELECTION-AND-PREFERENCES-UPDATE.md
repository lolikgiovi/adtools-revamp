# View Selection and Preferences Update

## Overview
This document tracks the changes made to improve view selection defaults, add lazy loading for performance, and implement persistent user preferences for comparison configurations.

## Changes Made

### 1. View Selection Updates

#### Removed Expandable Card Option from Dropdown
- **File**: `frontend/tools/compare-config/template.js`
- **Change**: Removed "Expandable Rows" option from the view type dropdown
- **Reason**: Simplifying view options; code is retained for backward compatibility

#### Changed Default View to Summary Grid
- **File**: `frontend/tools/compare-config/main.js`
- **Change**: Changed `this.currentView` default from `"expandable"` to `"grid"`
- **Reason**: Summary Grid is more useful as the default view

#### Renamed Master-Detail to Detail View
- **File**: `frontend/tools/compare-config/template.js`
- **Change**: Label changed from "Master-Detail" to "Detail View"
- **Reason**: More user-friendly terminology

### 2. GridView Performance - Lazy Loading

#### Implementation
- **File**: `frontend/tools/compare-config/views/GridView.js`
- **Approach**: Batch rendering with IntersectionObserver for lazy loading

#### Details
- Initial batch size: 100 rows
- Uses IntersectionObserver to detect when user scrolls near the bottom
- Renders additional batches of 100 rows as needed
- Shows "Showing X of Y rows" counter in footer

#### New Methods Added
```javascript
constructor()           // Initializes batch size, observer, and cached state
renderInitialBatch()    // Renders first batch of rows
attachEventListeners()  // Sets up IntersectionObserver for lazy loading
loadMoreRows()          // Loads and appends next batch of rows
cleanupObserver()       // Cleans up IntersectionObserver when re-rendering
```

#### Integration
- `main.js` now calls `this.gridView.attachEventListeners(resultsContent)` after rendering

### 3. GridView - Reference/Comparator Labels

#### Change
- **File**: `frontend/tools/compare-config/views/GridView.js`
- **Behavior**: When comparing with identical environment names (e.g., same filename in Excel compare), the header labels show "Reference" and "Comparator" instead of the duplicate name
- **Condition**: `env1Name === env2Name` (simple equality check)

### 4. IndexedDB - Excel File Preferences

#### New Store Added
- **Store Name**: `excelFilePrefs`
- **Key**: `refFilename` (reference filename)
- **DB Version**: Bumped from 1 to 2

#### New Functions
```javascript
saveExcelFilePrefs(prefs)      // Save preferences by reference filename
getExcelFilePrefs(refFilename) // Load preferences by reference filename
getAllExcelFilePrefs()         // Get all saved Excel preferences
deleteExcelFilePrefs(filename) // Delete preferences for a file
clearAllExcelFilePrefs()       // Clear all Excel preferences
```

#### Stored Fields
- `refFilename` - Reference filename (key)
- `selectedPkFields` - Array of primary key field names
- `selectedFields` - Array of comparison field names
- `rowMatching` - Row matching mode ('key' or 'position')
- `dataComparison` - Data comparison mode ('strict' or 'normalized')
- `lastUsed` - Timestamp

#### Integration in main.js
- **Load**: When parsing Excel files, saved preferences are loaded and applied (filtering to only include valid headers)
- **Save**: When running comparison, preferences are saved to IndexedDB

### 5. Schema/Table Preferences - Table Name Key

#### Change
- **File**: `frontend/tools/compare-config/lib/indexed-db-manager.js`
- **Function**: `generateSchemaTableKey()`
- **Previous**: Key was `${connectionId}_${schema}_${table}`
- **New**: Key is `table_${table}` (table name only)

#### Reason
- Preferences now persist across different connections and schemas
- If the same table name is used in different schemas, preferences are shared
- More portable and user-friendly

## File Summary

| File | Changes |
|------|---------|
| `template.js` | Removed expandable option, renamed Master-Detail to Detail View |
| `main.js` | Default view to grid, GridView attachEventListeners call, Excel prefs load/save |
| `views/GridView.js` | Lazy loading, Reference/Comparator labels |
| `lib/indexed-db-manager.js` | New EXCEL_FILE_PREFS store, DB version 2, table-name-only key |
| `styles.css` | Added row-count-info and load-sentinel styles |

## Testing Checklist

- [ ] Load compare-config tool - default view should be Summary Grid
- [ ] View dropdown should not show "Expandable Rows" option
- [ ] View dropdown should show "Detail View" instead of "Master-Detail"
- [ ] Load 1000+ row comparison in Summary Grid - verify lazy loading (shows X of Y rows)
- [ ] Scroll down - verify more rows load automatically
- [ ] Excel compare with same filename - verify "Reference" and "Comparator" labels
- [ ] Excel compare - select PK and fields, run comparison, reload tool - preferences should be restored
- [ ] Schema/Table compare - select fields, run comparison, switch tables, return - preferences should be restored

## Backward Compatibility

- Expandable view code is retained; users with saved "expandable" view will still see it work
- Existing schemaTablePrefs data may need to be re-saved with new table-name-only keys
- Old Excel file preferences (if any) are separate from the new system

## Date
2026-01-18
