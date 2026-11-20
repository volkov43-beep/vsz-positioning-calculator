import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rolldownOptions: {
      input: { index: "index.html", position: "src/core/position.ts", axis: "src/core/axis.ts" },
      preserveEntrySignatures: "strict",
      output: { entryFileNames: (chunk) => (chunk.name === "index" ? "assets/app-[hash].js" : "[name].js") },
    },
  },
});
