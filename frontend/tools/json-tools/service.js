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

  function extractKeys(content, includePaths) {
    try {
      const parsed = JSON.parse(content);
      const keys = getAllKeys(parsed, includePaths);
      const uniqueKeys = [...new Set(keys)].sort();
      const formatted = JSON.stringify(uniqueKeys, null, 2);
      return { result: formatted, error: null };
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
    getErrorPosition,
  };
