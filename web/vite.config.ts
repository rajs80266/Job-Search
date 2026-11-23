import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = `http://localhost:${process.env["PORT"] ?? 3001}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@server": path.resolve(import.meta.dirname, "../server/src") },
  },
  server: {
    port: 5174,
    proxy: { "/api": apiTarget },
  },
});
