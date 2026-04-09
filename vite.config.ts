import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [fresh()],
  ssr: {
    external: ["@db/sqlite"],
  },
});
