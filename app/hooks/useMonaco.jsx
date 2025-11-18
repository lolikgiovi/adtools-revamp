import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

/**
 * Custom hook for Monaco Editor integration
 * Handles editor creation, disposal, and common operations
 */
export function useMonaco({
  containerId,
  language = "plaintext",
  theme = "vs-dark",
  value = "",
  onChange,
  storageKey,
  options = {},
}) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Setup Monaco environment
    self.MonacoEnvironment = {
      getWorker() {
        return new editorWorker();
      },
    };

    // Wait for container to be available
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`Monaco container ${containerId} not found`);
      return;
    }

    containerRef.current = container;

    // Create editor
    const defaultOptions = {
      value: value,
      language: language,
      theme: theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: false,
      tabSize: 2,
      insertSpaces: true,
      ...options,
    };

    // Load from localStorage if storageKey provided
    let initialValue = value;
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) {
          initialValue = saved;
        }
      } catch (err) {
        console.warn("Failed to load from localStorage:", err);
      }
    }

    editorRef.current = monaco.editor.create(container, {
      ...defaultOptions,
      value: initialValue,
    });

    setIsReady(true);

    // Setup onChange handler with debouncing
    let persistTimer = null;
    const changeHandler = editorRef.current.onDidChangeModelContent(() => {
      const currentValue = editorRef.current.getValue();

      // Call onChange callback
      if (onChange) {
        onChange(currentValue);
      }

      // Persist to localStorage if storageKey provided
      if (storageKey) {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
          try {
            localStorage.setItem(storageKey, currentValue);
          } catch (err) {
            console.warn("Failed to save to localStorage:", err);
          }
        }, 300);
      }
    });

    // Cleanup
    return () => {
      clearTimeout(persistTimer);
      changeHandler.dispose();
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
      setIsReady(false);
    };
  }, [containerId]); // Only re-create if containerId changes

  // Update editor value when prop changes (but not on first render)
  useEffect(() => {
    if (editorRef.current && isReady) {
      const currentValue = editorRef.current.getValue();
      if (currentValue !== value) {
        editorRef.current.setValue(value);
      }
    }
  }, [value, isReady]);

  // Update editor language when it changes
  useEffect(() => {
    if (editorRef.current && isReady) {
      const model = editorRef.current.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, language);
      }
    }
  }, [language, isReady]);

  // Update editor theme when it changes
  useEffect(() => {
    if (isReady) {
      monaco.editor.setTheme(theme);
    }
  }, [theme, isReady]);

  const getValue = () => {
    return editorRef.current?.getValue() || "";
  };

  const setValue = (newValue) => {
    if (editorRef.current) {
      editorRef.current.setValue(newValue);
    }
  };

  const getEditor = () => {
    return editorRef.current;
  };

  return {
    editor: editorRef.current,
    isReady,
    getValue,
    setValue,
    getEditor,
  };
}
