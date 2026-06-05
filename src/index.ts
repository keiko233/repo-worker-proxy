import { Hono } from "hono";
import type { Context } from "hono";

const normalizeRepoIdentifier = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^github\.com\//, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();

// Hosts that carry the owner/repo in the first two path segments, so the
// allowlist can be enforced on a directly-embedded GitHub URL.
const ALLOWED_PASSTHROUGH_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
]);

const proxyResponse = async (c: Context, targetUrl: string) => {
  const response = await fetch(targetUrl);

  if (!response.ok) {
    return c.json(
      {
        error: "Failed to fetch file from repository",
        status: response.status,
        url: targetUrl,
      },
      response.status === 404 ? 404 : 500,
    );
  }

  const data = await response.arrayBuffer();

  return new Response(data, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "text/plain",
      "Cache-Control": "public, max-age=300",
    },
  });
};

const app = new Hono<{
  Bindings: CloudflareBindings;
}>();

app.all("*", async (c) => {
  const path = c.req.path;
  const allowSourceRepos = c.env.SOURCE_REPOS.split(",")
    .map(normalizeRepoIdentifier)
    .filter((value) => value !== "");

  if (allowSourceRepos.length > 0) {
    // Format: /<full github url>
    // e.g. /https://github.com/owner/repo/releases/download/tag/file
    // The leading slash is dropped and the URL pathname may collapse the
    // "//" in the scheme, so allow any number of slashes after "https:".
    const embeddedMatch = (c.req.path.slice(1) + (new URL(c.req.url).search))
      .match(/^(https?):\/*(.+)$/i);

    if (embeddedMatch) {
      let targetUrl: URL;
      try {
        targetUrl = new URL(`${embeddedMatch[1].toLowerCase()}://${embeddedMatch[2]}`);
      } catch {
        return c.json({ error: "Invalid embedded URL" }, 400);
      }

      if (!ALLOWED_PASSTHROUGH_HOSTS.has(targetUrl.hostname.toLowerCase())) {
        return c.json({ error: "Host not allowed" }, 403);
      }

      const segments = targetUrl.pathname.split("/").filter((part) => part !== "");
      if (segments.length < 2) {
        return c.json({ error: "Invalid path format. Expected: /<github url>" }, 400);
      }

      const repoSlug = normalizeRepoIdentifier(`${segments[0]}/${segments[1]}`);
      if (!allowSourceRepos.includes(repoSlug)) {
        return c.json({ error: "Repository not allowed" }, 403);
      }

      try {
        return await proxyResponse(c, targetUrl.toString());
      } catch (error) {
        return c.json(
          {
            error: "Failed to fetch repository data",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          500,
        );
      }
    }

    const pathParts = path.split("/").filter((part) => part !== "");

    if (pathParts.length < 3) {
      return c.json(
        {
          error: "Invalid path format. Expected: /username/repo/...",
        },
        400,
      );
    }

    const username = pathParts[0];
    const repo = pathParts[1];
    const repoSlug = normalizeRepoIdentifier(`${username}/${repo}`);

    if (!allowSourceRepos.includes(repoSlug)) {
      return c.json(
        {
          error: "Repository not allowed",
        },
        403,
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
        githubRawUrl =
          `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${filePath}`;
      } else if (pathParts[2] === "release" && pathParts.length >= 4) {
        // Format: /username/repo/release/file/path
        const filePath = pathParts.slice(3).join("/");
        githubRawUrl =
          `https://github.com/${username}/${repo}/releases/latest/download/${filePath}`;
      } else if (
        pathParts[2] === "releases" &&
        pathParts[3] === "download" &&
        pathParts.length >= 6
      ) {
        // Format: /username/repo/releases/download/tag/file/path
        const tag = pathParts[4];
        const filePath = pathParts.slice(5).join("/");
        githubRawUrl =
          `https://github.com/${username}/${repo}/releases/download/${tag}/${filePath}`;
      } else if (pathParts.length >= 4) {
        // Default format: /username/repo/branch/file/path (assume it's a branch)
        const branch = pathParts[2];
        const filePath = pathParts.slice(3).join("/");
        githubRawUrl =
          `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${filePath}`;
      } else {
        return c.json(
          {
            error: "Invalid path format. Supported formats:\n" +
              "- /username/repo/branch/file/path\n" +
              "- /username/repo/refs/heads/branch/file/path\n" +
              "- /username/repo/release/file/path (latest release)\n" +
              "- /username/repo/releases/download/tag/file/path",
          },
          400,
        );
      }

      return await proxyResponse(c, githubRawUrl);
    } catch (error) {
      return c.json(
        {
          error: "Failed to fetch repository data",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  }

  return c.json(
    {
      error: "No source repositories configured",
    },
    500,
  );
});

export default app;
