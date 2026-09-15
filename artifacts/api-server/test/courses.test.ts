import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://localhost:5432/schoolcircle_test";

const [{ default: app }, { prisma }] = await Promise.all([
  import("../src/app.js"),
  import("../src/lib/prisma.js"),
]);

const approvedQuestion = {
  id: "approved-question",
  kind: "QUESTION",
  stem: "Which answer is supported?",
  options: ["Supported", "Unsupported"],
  answer: 0,
  rationale: "The cited doctrine supports the first option.",
  citation: { citation: "TC 3-22.9, Ch 7, para 1", pubId: "TC 3-22.9" },
  support: 0.93,
  status: "APPROVED",
};

const pendingQuestion = { ...approvedQuestion, id: "pending-question", status: "PENDING" };
const rejectedQuestion = { ...approvedQuestion, id: "rejected-question", status: "REJECTED" };
const databaseItems = [approvedQuestion, pendingQuestion, rejectedQuestion];

const section = {
  id: "section-1",
  courseId: "course-1",
  title: "Chapter 7",
  order: 7,
  items: [approvedQuestion],
};

const course = {
  id: "course-1",
  title: "Rifle Marksmanship",
  sourceId: "TC 3-22.9",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  sections: [section],
};

function databaseCourseForQuery(query: any) {
  const status = query?.include?.sections?.include?.items?.where?.status;
  const items = status === "APPROVED"
    ? databaseItems.filter((item) => item.status === "APPROVED")
    : databaseItems;
  return {
    ...course,
    sections: [{ ...section, items }],
  };
}

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

async function request(path: string) {
  const { server, port } = await listen();
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`);
  } finally {
    server.close();
  }
}

test("course list applies the APPROVED filter in the Prisma query and envelope", async () => {
  const findMany = prisma.course.findMany;
  let query: unknown;
  prisma.course.findMany = (async (args: any) => {
    query = args;
    return [databaseCourseForQuery(args)];
  }) as typeof prisma.course.findMany;

  try {
    const response = await request("/api/courses");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).courses[0].sections[0].items, [approvedQuestion]);
    assert.deepEqual((query as any).include.sections.include.items.where, { status: "APPROVED" });
    assert.deepEqual((query as any).include.sections.orderBy, { order: "asc" });
    assert.deepEqual((query as any).include.sections.include.items.orderBy, { createdAt: "asc" });
  } finally {
    prisma.course.findMany = findMany;
  }
});

test("course detail applies the APPROVED filter and returns question fields", async () => {
  const findUnique = prisma.course.findUnique;
  let query: unknown;
  prisma.course.findUnique = (async (args: any) => {
    query = args;
    return databaseCourseForQuery(args);
  }) as unknown as typeof prisma.course.findUnique;

  try {
    const response = await request("/api/courses/course-1");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual((query as any).include.sections.include.items.where, { status: "APPROVED" });
    assert.deepEqual(
      body.course.sections[0].items.map((item: { id: string }) => item.id),
      ["approved-question"],
    );
    assert.equal(body.course.sections[0].items[0].kind, "QUESTION");
    assert.deepEqual(body.course.sections[0].items[0].options, approvedQuestion.options);
    assert.equal(body.course.sections[0].items[0].answer, 0);
    assert.equal(body.course.sections[0].items[0].rationale, approvedQuestion.rationale);
    assert.deepEqual(body.course.sections[0].items[0].citation, approvedQuestion.citation);
    assert.equal(body.course.sections[0].items[0].support, approvedQuestion.support);
  } finally {
    prisma.course.findUnique = findUnique;
  }
});

test("course detail returns 404 for a missing course", async () => {
  const findUnique = prisma.course.findUnique;
  prisma.course.findUnique = (async () => null) as unknown as typeof prisma.course.findUnique;

  try {
    const response = await request("/api/courses/missing");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "course not found" });
  } finally {
    prisma.course.findUnique = findUnique;
  }
});