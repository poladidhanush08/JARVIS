/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vitest 2 bundles its own Vite 5 types, which do not augment Vite 6's UserConfig;
// keeping the test block in a separate object avoids the excess-property check.
const test = { environment: "jsdom", setupFiles: "./src/setupTests.ts", globals: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  ...{ test },
});
