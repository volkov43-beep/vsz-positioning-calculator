import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/vsz-positioning-calculator/" : "./",
  build: {
    target: "es2022",
    rolldownOptions: mode === "pages" ? undefined : {
      input: { index: "index.html", position: "src/core/position.ts", axis: "src/core/axis.ts" },
      preserveEntrySignatures: "strict",
      output: { entryFileNames: (chunk) => (chunk.name === "index" ? "assets/app-[hash].js" : "[name].js") },
    },
  },
}));
