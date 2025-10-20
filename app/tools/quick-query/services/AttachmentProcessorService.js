export class AttachmentProcessorService {
  constructor() {
    this.attachmentsContainer = null;
    this.fileContents = {};
  }

  // The business process will be processing the file
  // based on its format, and returning it as three format for each file
  // 1. original value (for txt, html, json)
  // 2. base64 encoded value (for images, pdf)

  async processAttachments(files) {
    console.log("Processing attachments");
    const processedFiles = [];

    for (const file of files) {
      console.log("Processing file:", file.name);
      const sanitizedFileName = file.name.replace(/\s+/g, "_");
      const extension = sanitizedFileName.split(".").pop().toLowerCase();
      const processedFile = {
        name: sanitizedFileName,
        type: file.type,
        size: file.size,
        processedFormats: {
          original: null,
          base64: null,
          sizes: {
            original: 0,
            base64: 0,
          },
        },
      };

      try {
        switch (extension) {
          case "jpg":
          case "jpeg":
          case "png":
          case "pdf":
            await this.handleMediaFile(file, processedFile);
            break;
          case "txt":
          case "html":
          case "json":
            await this.handleTextFile(file, processedFile);
            break;
          default:
            console.warn(`Unsupported file type: ${extension}`);
        }
        processedFiles.push(processedFile);
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
      }
    }

    return processedFiles;
  }

  async handleMediaFile(file, processedFile) {
    // Read as base64
    const base64Data = await this.readFileAs(file, "dataURL");
    processedFile.processedFormats.base64 = base64Data;
    processedFile.processedFormats.sizes.base64 = base64Data.length;
  }

  async handleTextFile(file, processedFile) {
    const textContent = await this.readFileAs(file, "text");
    processedFile.processedFormats.original = textContent;
    processedFile.processedFormats.contentType = "text/plain";

    const cleaned = textContent.trim();
    if (!cleaned) {
      processedFile.processedFormats.sizes.original = 0;
      return;
    }

    // Check for data URI base64 pattern
    if (cleaned.match(/^data:.*?;base64,/)) {
      processedFile.type = "text/base64";
      processedFile.processedFormats.contentType = "text/base64";
      processedFile.processedFormats.base64 = cleaned;

      // Extract and decode base64 content
      const base64Content = cleaned.split(",")[1];
      try {
        const decoded = atob(base64Content);
        processedFile.processedFormats.sizes.original = decoded.length;
        processedFile.processedFormats.sizes.base64 = cleaned.length;
      } catch (e) {
        processedFile.processedFormats.sizes.original = new TextEncoder().encode(textContent).length;
      }
    } else {
      processedFile.processedFormats.sizes.original = new TextEncoder().encode(textContent).length;
    }
  }

  readFileAs(file, readAs) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Error reading file"));

      switch (readAs) {
        case "arrayBuffer":
          reader.readAsArrayBuffer(file);
          break;
        case "dataURL":
          reader.readAsDataURL(file);
          break;
        case "text":
          reader.readAsText(file);
          break;
      }
    });
  }

  minifyContent(file) {
    if (!file.processedFormats.original) return file;

    const extension = file.name.split(".").pop().toLowerCase();
    let minified = file.processedFormats.original;

    switch (extension) {
      case "html":
        // Minify HTML: remove extra spaces, newlines, and comments
        minified = minified
          .replace(/<!--[\s\S]*?-->/g, "") // Remove comments
          .replace(/\s+/g, " ") // Replace multiple spaces with single space
          .replace(/>\s+</g, "><") // Remove spaces between tags
          .trim();
        break;

      case "json":
        // Minify JSON: parse and stringify without spaces
        try {
          minified = JSON.stringify(JSON.parse(minified));
        } catch (e) {
          console.error("JSON minification failed:", e);
        }
        break;

      default:
        // For other text files: remove extra spaces and empty lines
        minified = minified
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line)
          .join("\n");
    }

    return {
      ...file,
      processedFormats: {
        ...file.processedFormats,
        original: minified,
      },
    };
  }
}
