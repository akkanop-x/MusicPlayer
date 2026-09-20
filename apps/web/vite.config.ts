import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Socket.IO (websocket.md) — ต้อง proxy upgrade ด้วย
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
