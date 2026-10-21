import { optimizePng } from "./service.js";

self.onmessage = ({ data }) => {
  try {
    const result = optimizePng(new Uint8Array(data), (stage, details) => self.postMessage({ log: { stage, details } }));
    self.postMessage({ result }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "Unable to process this PNG." });
  }
};
