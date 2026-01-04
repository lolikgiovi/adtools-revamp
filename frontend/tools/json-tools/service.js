// JSON Tools Service - pure logic functions (no DOM access)
  function getErrorPosition(errorMessage) {
    const match = (errorMessage || "").match(/position (\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function validate(content) {
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      return { result: formatted, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function prettify(content) {
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      return { result: formatted, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function minify(content) {
    try {
      const parsed = JSON.parse(content);
      const minified = JSON.stringify(parsed);
      return { result: minified, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function stringify(content) {
    try {
      const parsed = JSON.parse(content);
      const stringified = JSON.stringify(JSON.stringify(parsed, null, 2));
      return { result: stringified, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function unstringify(content) {
    try {
      const firstParse = JSON.parse(content);
      if (typeof firstParse !== "string") {
        throw new Error("Input is not a JSON string");
      }
      const secondParse = JSON.parse(firstParse);
      const formatted = JSON.stringify(secondParse, null, 2);
      return { result: formatted, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function escape(content) {
    try {
      // Validate JSON first
      JSON.parse(content);
      const escaped = content.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
      return { result: `"${escaped}"`, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function unescape(content) {
    try {
      const unescaped = JSON.parse(content);
      if (typeof unescaped !== "string") {
        throw new Error("Input is not an escaped JSON string");
      }
      const parsed = JSON.parse(unescaped);
      const formatted = JSON.stringify(parsed, null, 2);
      return { result: formatted, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function getAllKeys(obj, includePaths = false, currentPath = "") {
    const keys = [];

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          const newPath = includePaths ? `${currentPath}[${index}]` : "";
          keys.push(...getAllKeys(item, includePaths, newPath));
        }
      });
    } else if (typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach((key) => {
        const newPath = includePaths ? (currentPath ? `${currentPath}.${key}` : key) : "";

        if (includePaths) {
          keys.push(newPath);
        } else {
          keys.push(key);
        }

        if (typeof obj[key] === "object" && obj[key] !== null) {
          keys.push(...getAllKeys(obj[key], includePaths, newPath));
        }
      });
    }

    return keys;
  }

  function extractKeys(content, includePaths, sortOrder = "natural") {
    try {
      const parsed = JSON.parse(content);
      const keys = getAllKeys(parsed, includePaths);
      let uniqueKeys = [...new Set(keys)];
      
      // Apply sorting based on sortOrder
      if (sortOrder === "asc") {
        uniqueKeys.sort((a, b) => a.localeCompare(b));
      } else if (sortOrder === "desc") {
        uniqueKeys.sort((a, b) => b.localeCompare(a));
      }
      // "natural" keeps the original order (no sorting)
      
      const formatted = JSON.stringify(uniqueKeys, null, 2);
      return { result: formatted, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatCellValue(value, depth = 0) {
    if (value === null) return '<span class="null-value">null</span>';
    if (value === undefined) return '<span class="undefined-value">—</span>';
    if (typeof value === "boolean") return `<span class="boolean-value">${value}</span>`;
    if (typeof value === "number") return `<span class="number-value">${value}</span>`;
    
    // Handle arrays - render as nested table
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '<span class="empty-array">[ ]</span>';
      }
      // Limit nesting depth to prevent infinite recursion
      if (depth > 3) {
        return `<span class="object-value">${escapeHtml(JSON.stringify(value))}</span>`;
      }
      return buildNestedTable(value, depth + 1);
    }
    
    // Handle objects - render as nested table
    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return '<span class="empty-object">{ }</span>';
      }
      // Limit nesting depth
      if (depth > 3) {
        return `<span class="object-value">${escapeHtml(JSON.stringify(value))}</span>`;
      }
      return buildNestedTable([value], depth + 1, true);
    }
    
    return escapeHtml(String(value));
  }

  function buildNestedTable(dataArray, depth = 0, isSingleObject = false) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return '<span class="empty-array">[ ]</span>';
    }

    // For single object passed as array, render as key-value table
    if (isSingleObject && dataArray.length === 1 && typeof dataArray[0] === "object" && dataArray[0] !== null && !Array.isArray(dataArray[0])) {
      const obj = dataArray[0];
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return '<span class="empty-object">{ }</span>';
      }
      
      let html = `<table class="json-table nested-table depth-${depth} transposed">`;
      html += '<thead><tr><th class="row-index-header">Key</th><th>Value</th></tr></thead><tbody>';
      keys.forEach(key => {
        html += `<tr><td class="row-index">${escapeHtml(key)}</td><td>${formatCellValue(obj[key], depth)}</td></tr>`;
      });
      html += '</tbody></table>';
      return html;
    }

    // For arrays (including mixed types), render as Index/Value table
    let html = `<table class="json-table nested-table depth-${depth} transposed">`;
    html += '<thead><tr><th class="row-index-header">Index</th><th>Value</th></tr></thead><tbody>';
    dataArray.forEach((item, index) => {
      html += `<tr><td class="row-index">${index}</td><td>${formatCellValue(item, depth)}</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
  }

  function jsonToTable(content, transpose = false, keySortOrder = "natural") {
    try {
      const parsed = JSON.parse(content);
      
      // Handle different JSON structures
      let dataArray;
      let isSingleObject = false;
      
      if (Array.isArray(parsed)) {
        dataArray = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Single object - wrap in array
        dataArray = [parsed];
        isSingleObject = true;
      } else {
        // Primitive value - create simple table
        return {
          result: `<table class="json-table"><tbody><tr><td>${formatCellValue(parsed, 0)}</td></tr></tbody></table>`,
          error: null
        };
      }

      if (dataArray.length === 0) {
        return { result: '<div class="empty-table">Empty array - no data to display</div>', error: null };
      }

      // Get all unique keys from all objects
      const allKeys = new Set();
      dataArray.forEach(item => {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          Object.keys(item).forEach(key => allKeys.add(key));
        }
      });

      const headers = Array.from(allKeys);
      
      if (headers.length === 0) {
        // Array of primitives
        let html = '<table class="json-table"><thead><tr><th>#</th><th>Value</th></tr></thead><tbody>';
        dataArray.forEach((item, index) => {
          html += `<tr><td class="row-index">${index}</td><td>${formatCellValue(item, 0)}</td></tr>`;
        });
        html += '</tbody></table>';
        return { result: html, error: null };
      }

      // Build table HTML - check for transpose mode
      if (transpose) {
        // Sort headers based on keySortOrder
        let sortedHeaders = [...headers];
        let sortIndicator = " ⇅"; // Default: double arrow to indicate sortable
        if (keySortOrder === "asc") {
          sortedHeaders.sort((a, b) => a.localeCompare(b));
          sortIndicator = " ▲";
        } else if (keySortOrder === "desc") {
          sortedHeaders.sort((a, b) => b.localeCompare(a));
          sortIndicator = " ▼";
        }
        // natural keeps original order, shows ⇅

        // Transposed: keys are rows, indices are columns
        // Add # column for key numbering
        let html = '<table class="json-table transposed"><thead><tr>';
        html += '<th class="row-index-header">#</th>';
        html += `<th class="key-header key-header-sortable" title="Click to sort">Key${sortIndicator}</th>`;
        if (!isSingleObject) {
          dataArray.forEach((_, index) => {
            html += `<th>${index}</th>`;
          });
        } else {
          html += '<th>Value</th>';
        }
        html += '</tr></thead><tbody>';

        sortedHeaders.forEach((header, keyIndex) => {
          html += `<tr><td class="key-index">${keyIndex + 1}</td><td class="row-index">${escapeHtml(header)}</td>`;
          dataArray.forEach(item => {
            const value = typeof item === "object" && item !== null ? item[header] : undefined;
            html += `<td>${formatCellValue(value, 0)}</td>`;
          });
          html += '</tr>';
        });

        html += '</tbody></table>';
        return { result: html, error: null };
      }

      // Normal table: keys are columns, indices are rows
      // Add a number row above the header row for key numbering
      let html = '<table class="json-table"><thead>';
      
      // Key number row
      html += '<tr class="key-number-row">';
      if (!isSingleObject) {
        html += '<th class="row-index-header"></th>';
      }
      headers.forEach((_, keyIndex) => {
        html += `<th class="key-index">${keyIndex + 1}</th>`;
      });
      html += '</tr>';
      
      // Key name row
      html += '<tr>';
      if (!isSingleObject) {
        html += '<th class="row-index-header">#</th>';
      }
      headers.forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
      });
      html += '</tr></thead><tbody>';

      dataArray.forEach((item, index) => {
        html += '<tr>';
        if (!isSingleObject) {
          html += `<td class="row-index">${index}</td>`;
        }
        headers.forEach(header => {
          const value = typeof item === "object" && item !== null ? item[header] : undefined;
          html += `<td>${formatCellValue(value, 0)}</td>`;
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      return { result: html, error: null };
    } catch (error) {
      return { result: null, error: { message: error.message, position: getErrorPosition(error.message) } };
    }
  }

  export const JSONToolsService = {
    validate,
    prettify,
    minify,
    stringify,
    unstringify,
    escape,
    unescape,
    extractKeys,
    jsonToTable,
    getErrorPosition,
  };
