import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    lib: { entry: { position: "src/core/position.ts", axis: "src/core/axis.ts" },
      formats: ["es"], fileName: (_format, entry) => entry + ".js" },
  },
});
