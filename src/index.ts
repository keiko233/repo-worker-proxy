import { Hono } from "hono";

const app = new Hono<{
  Bindings: CloudflareBindings;
}>();

app.all("*", async (c) => {
  const path = c.req.path;
  const allowSourceRepos = c.env.SOURCE_REPOS.split(",");

  if (allowSourceRepos.length > 0) {
    const pathParts = path.split("/").filter((part) => part !== "");

    if (pathParts.length < 3) {
      return c.json(
        {
          error: "Invalid path format. Expected: /username/repo/...",
        },
        400
      );
    }

    const username = pathParts[0];
    const repo = pathParts[1];
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
      let githubRawUrl: string;

      // Handle different GitHub URL patterns
      if (
        pathParts[2] === "refs" &&
        pathParts[3] === "heads" &&
        pathParts.length >= 6
      ) {
        // Format: /username/repo/refs/heads/branch/file/path
        const branch = pathParts[4];
        const filePath = pathParts.slice(5).join("/");
        githubRawUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${filePath}`;
      } else if (pathParts[2] === "release" && pathParts.length >= 4) {
        // Format: /username/repo/release/file/path
        const filePath = pathParts.slice(3).join("/");
        githubRawUrl = `https://github.com/${username}/${repo}/releases/latest/download/${filePath}`;
      } else if (
        pathParts[2] === "releases" &&
        pathParts[3] === "download" &&
        pathParts.length >= 6
      ) {
        // Format: /username/repo/releases/download/tag/file/path
        const tag = pathParts[4];
        const filePath = pathParts.slice(5).join("/");
        githubRawUrl = `https://github.com/${username}/${repo}/releases/download/${tag}/${filePath}`;
      } else if (pathParts.length >= 4) {
        // Default format: /username/repo/branch/file/path (assume it's a branch)
        const branch = pathParts[2];
        const filePath = pathParts.slice(3).join("/");
        githubRawUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${filePath}`;
      } else {
        return c.json(
          {
            error:
              "Invalid path format. Supported formats:\n" +
              "- /username/repo/branch/file/path\n" +
              "- /username/repo/refs/heads/branch/file/path\n" +
              "- /username/repo/release/file/path (latest release)\n" +
              "- /username/repo/releases/download/tag/file/path",
          },
          400
        );
      }

      const response = await fetch(githubRawUrl);

      if (!response.ok) {
        return c.json(
          {
            error: "Failed to fetch file from repository",
            status: response.status,
            url: githubRawUrl,
          },
          response.status === 404 ? 404 : 500
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
