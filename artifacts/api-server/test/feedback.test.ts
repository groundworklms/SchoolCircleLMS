import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://localhost:5432/schoolcircle_test";

const { default: app } = await import("../src/app.js");

function listen() {
  const server = app.listen(0);
  return once(server, "listening").then(() => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }
    return { server, port: address.port };
  });
}

async function request(body: unknown, headers: Record<string, string> = {}) {
  const { server, port } = await listen();
  try {
    return await fetch(`http://127.0.0.1:${port}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
  }
}

async function withEnvironment(
  values: Record<string, string | undefined>,
  callback: () => Promise<void>,
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withGithubFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
  callback: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://api.github.com/")) {
      return handler(url, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("feedback remains disabled without the server token", async () => {
  await withEnvironment(
    {
      GITHUB_FEEDBACK_TOKEN: undefined,
      FEEDBACK_KEY: undefined,
    },
    async () => {
      const response = await request({ title: "A report" });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Feedback is not configured on this deployment",
      });
    },
  );
});

test("feedback rejects an incorrect optional team key", async () => {
  await withEnvironment(
    {
      GITHUB_FEEDBACK_TOKEN: "server-token",
      FEEDBACK_KEY: "correct-key",
    },
    async () => {
      const response = await request(
        { title: "A report" },
        { "x-feedback-key": "wrong-key" },
      );
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Bad team key" });
    },
  );
});

test("feedback validates the required title", async () => {
  await withEnvironment(
    {
      GITHUB_FEEDBACK_TOKEN: "server-token",
      FEEDBACK_KEY: undefined,
    },
    async () => {
      const response = await request({
        description: "A description without a title",
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Title is required" });
    },
  );
});

test("feedback creates the expected GitHub issue without exposing the token", async () => {
  const token = "server-token";
  let githubUrl = "";
  let githubInit: RequestInit | undefined;

  await withEnvironment(
    {
      GITHUB_FEEDBACK_TOKEN: token,
      FEEDBACK_KEY: "team-key",
      GITHUB_FEEDBACK_REPO: "example/project",
    },
    async () => {
      await withGithubFetch(
        async (url, init) => {
          githubUrl = url;
          githubInit = init;
          return new Response(
            JSON.stringify({
              number: 123,
              html_url: "https://github.com/example/project/issues/123",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        },
        async () => {
          const response = await request(
            {
              title: "  Button is difficult to find  ",
              type: "idea",
              description: "  Put the button closer to the lesson controls.  ",
              context: {
                where: "lesson reader",
                url: "https://example.test/lesson",
                build: "test",
                viewport: "1024x768",
                userAgent: "test browser",
                reporter: "Tester",
              },
            },
            { "x-feedback-key": "team-key" },
          );

          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), {
            number: 123,
            url: "https://github.com/example/project/issues/123",
          });
        },
      );
    },
  );

  assert.equal(
    githubUrl,
    "https://api.github.com/repos/example/project/issues",
  );
  assert.equal(
    new Headers(githubInit?.headers).get("authorization"),
    `Bearer ${token}`,
  );
  const issue = JSON.parse(String(githubInit?.body));
  assert.equal(issue.title, "Button is difficult to find");
  assert.deepEqual(issue.labels, ["enhancement", "qa"]);
  assert.match(issue.body, /lesson reader/);
  assert.doesNotMatch(
    JSON.stringify({
      response: "the token is never returned",
      issue,
    }),
    new RegExp(token),
  );
});

test("feedback maps GitHub failures to a safe 502 response", async () => {
  const token = "server-token";

  await withEnvironment(
    {
      GITHUB_FEEDBACK_TOKEN: token,
      FEEDBACK_KEY: undefined,
      GITHUB_FEEDBACK_REPO: "example/project",
    },
    async () => {
      await withGithubFetch(
        async () =>
          new Response(
            JSON.stringify({ message: `upstream leaked ${token}` }),
            { status: 422, headers: { "content-type": "application/json" } },
          ),
        async () => {
          const response = await request({ title: "A report" });
          assert.equal(response.status, 502);
          const body = await response.json();
          assert.deepEqual(body, { error: "GitHub returned 422" });
          assert.doesNotMatch(JSON.stringify(body), new RegExp(token));
        },
      );
    },
  );
});