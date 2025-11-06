import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ui": "/app/ui",
      "@graph": "/app/graph",
      "@codegen": "/app/codegen",
      "@compiler": "/app/compiler",
      "@audio": "/app/audio",
      "@dsp": "/app/dsp",
      "@tests": "/app/tests"
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
      supported: {
        "top-level-await": true
      }
    }
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 11000
  }
});
