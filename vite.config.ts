import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    lib: { entry: "src/core/position.ts", formats: ["es"], fileName: "position" },
  },
});
