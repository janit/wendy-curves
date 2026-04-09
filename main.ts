import { App, staticFiles } from "fresh";

export const app = new App()
  .use(staticFiles())
  .fsRoutes();

if (import.meta.main) {
  const { boot } = await import("./lib/boot.ts");
  const port = await boot();
  await app.listen({ port, hostname: "0.0.0.0" });
  console.log(`[wendy-curves] http://localhost:${port}`);
}
