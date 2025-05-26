import { Hono } from "hono";

const app = new Hono<{
  Bindings: CloudflareBindings;
}>();

app.all("*", async (c) => {
  const path = c.req.path;

  const sourceRepo = c.env.SOURCE_REPO;

  if (sourceRepo) {
    const sourceUrl = new URL(sourceRepo);

    try {
      // eg: https://raw.githubusercontent.com/keiko233/nyanpasu-scripts/refs/heads/main/easywarp-provider.js
      const response = await fetch(
        `https://raw.githubusercontent.com/${sourceUrl.pathname}/refs/heads/${path}`
      );

      const data = await response.text();

      return new Response(data, {
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "text/plain",
        },
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to fetch repository data",
        },
        500
      );
    }
  }
});

export default app;
