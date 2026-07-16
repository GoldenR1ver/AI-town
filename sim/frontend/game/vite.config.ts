import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const gameRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: gameRoot,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@game": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../../shared", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5177,
    fs: {
      allow: [
        gameRoot,
        fileURLToPath(new URL("../../shared", import.meta.url)),
      ],
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
