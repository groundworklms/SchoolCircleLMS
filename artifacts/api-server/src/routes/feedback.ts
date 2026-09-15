import { Router, type IRouter } from "express";

const DEFAULT_REPO = "groundworklms/SchoolCircleLMS";
const FEEDBACK_TIMEOUT_MS = 10_000;
const MAX_CONTEXT_VALUE_LENGTH = 1_000;

const TYPES = {
  bug: ["bug", "qa"],
  enhancement: ["enhancement", "qa"],
  idea: ["enhancement", "qa"],
  question: ["question", "qa"],
} as const;

type FeedbackType = keyof typeof TYPES;
type FeedbackContext = Record<string, unknown>;

const router: IRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimValue(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) {
    return "";
  }

  try {
    return String(value).trim().slice(0, maxLength);
  } catch {
    return "";
  }
}

function contextValue(
  context: FeedbackContext,
  name: string,
  fallback: string,
): string {
  return trimValue(context[name], MAX_CONTEXT_VALUE_LENGTH) || fallback;
}

router.post("/feedback", async (req, res) => {
  // The token is read only on the server and is never included in a response
  // or an error message. Feedback remains disabled when it is not configured.
  const token = process.env.GITHUB_FEEDBACK_TOKEN;
  if (!token || !token.trim()) {
    res
      .status(503)
      .json({ error: "Feedback is not configured on this deployment" });
    return;
  }

  const key = process.env.FEEDBACK_KEY;
  if (key && req.get("x-feedback-key") !== key) {
    res.status(401).json({ error: "Bad team key" });
    return;
  }

  if (!isRecord(req.body)) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const title = trimValue(req.body.title, 200);
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  const rawType = req.body.type;
  const type: FeedbackType =
    typeof rawType === "string" &&
    Object.prototype.hasOwnProperty.call(TYPES, rawType)
      ? (rawType as FeedbackType)
      : "bug";
  const description = trimValue(req.body.description, 10_000);
  const context = isRecord(req.body.context) ? req.body.context : {};

  const issueBody = [
    description || "_No description given._",
    "",
    "---",
    "<details><summary>Context (auto-captured by in-app widget)</summary>",
    "",
    "| | |",
    "|---|---|",
    `| Where | ${contextValue(context, "where", "?")} |`,
    `| URL | ${contextValue(context, "url", "?")} |`,
    `| Build | ${contextValue(context, "build", "unknown")} |`,
    `| Viewport | ${contextValue(context, "viewport", "?")} |`,
    `| Browser | ${contextValue(context, "userAgent", "?")} |`,
    `| Reporter | ${contextValue(context, "reporter", "anonymous")} |`,
    `| Time | ${new Date().toISOString()} |`,
    "",
    "</details>",
  ].join("\n");

  const configuredRepo = trimValue(
    process.env.GITHUB_FEEDBACK_REPO,
    MAX_CONTEXT_VALUE_LENGTH,
  );
  const repo = configuredRepo || DEFAULT_REPO;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEEDBACK_TIMEOUT_MS);

  let githubResponse: Response;
  try {
    githubResponse = await fetch(
      `https://api.github.com/repos/${repo}/issues`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({
          title,
          body: issueBody,
          labels: TYPES[type],
        }),
        signal: controller.signal,
      },
    );
  } catch {
    clearTimeout(timeout);
    res.status(502).json({ error: "Unable to submit feedback to GitHub" });
    return;
  }

  if (!githubResponse.ok) {
    // Do not pass through GitHub's response: it could contain sensitive
    // request details, and clients only need to know that filing failed.
    clearTimeout(timeout);
    res.status(502).json({ error: `GitHub returned ${githubResponse.status}` });
    return;
  }

  let data: unknown;
  try {
    data = await githubResponse.json();
  } catch {
    clearTimeout(timeout);
    res.status(502).json({ error: "Invalid response from GitHub" });
    return;
  }
  clearTimeout(timeout);

  if (
    !isRecord(data) ||
    typeof data.number !== "number" ||
    typeof data.html_url !== "string" ||
    data.html_url.includes(token)
  ) {
    res.status(502).json({ error: "Invalid response from GitHub" });
    return;
  }

  res.json({ number: data.number, url: data.html_url });
});

export default router;