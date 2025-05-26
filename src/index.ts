import { Hono } from "hono";

const app = new Hono<{
  Bindings: CloudflareBindings;
}>();

app.all("*", async (c) => {
  // eg: /keiko233/nyanpasu-scripts/refs/heads/main/easywarp-provider.js
  const path = c.req.path;

  // eg: https://github.com/keiko233/nyanpasu-scripts
  const allowSourceRepos = c.env.SOURCE_REPOS.split(",");

  if (allowSourceRepos.length > 0) {
    const pathParts = path.split("/").filter((part) => part !== "");

    if (pathParts.length < 5) {
      return c.json(
        {
          error:
            "Invalid path format. Expected: /username/repo/refs/heads/branch/file-path",
        },
        400
      );
    }

    const username = pathParts[0];
    const repo = pathParts[1];
    const branch = pathParts[4];
    const filePath = pathParts.slice(5).join("/");

    const repoUrl = `https://github.com/${username}/${repo}`;

    if (!allowSourceRepos.includes(repoUrl)) {
      return c.json(
        {
          error: "Repository not allowed",
        },
        403
      );
    }

    try {
      const githubRawUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${filePath}`;

      const response = await fetch(githubRawUrl);

      if (!response.ok) {
        return c.json(
          {
            error: "Failed to fetch file from repository",
            status: response.status,
          },
          500
        );
      }

      const data = await response.text();

      return new Response(data, {
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "text/plain",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to fetch repository data",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  }

  return c.json(
    {
      error: "No source repositories configured",
    },
    500
  );
});

export default app;
