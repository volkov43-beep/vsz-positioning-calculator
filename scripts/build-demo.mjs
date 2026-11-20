// Portable copy for an offline review. Both builds use the same React entry and axis core.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "vite";

const result = await build({
  configFile: false,
  mode: "production",
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2022",
    write: false,
    lib: {
      entry: "src/web/main.tsx",
      formats: ["iife"],
      name: "VszDemo",
    },
  },
});
const [{ output }] = Array.isArray(result) ? result : [result];
const js = output.filter((f) => f.type === "chunk");
const css = output.filter((f) => f.type === "asset" && f.fileName.endsWith(".css"));
if (
  js.length !== 1 ||
  css.length !== 1 ||
  output.length !== 2 ||
  js[0].imports.length ||
  js[0].dynamicImports.length
)
  throw new Error("Expected one self-contained script and stylesheet");
const html = (await readFile("index.html", "utf8"))
  .replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`)
  .replace("</head>", () => "<style>" + css[0].source + "</style></head>")
  .replace(
    '<script type="module" src="./src/web/main.tsx"></script>',
    () => "<script>" + js[0].code.replace(/<\/script/gi, "<\\/script") + "</script>",
  );
await mkdir("dist", { recursive: true });
await writeFile("dist/VSZ-calculator-07D3.html", html);
