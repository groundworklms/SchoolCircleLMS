import { NextResponse } from "next/server";
import { ask } from "@/lib/doctrine";

export const dynamic = "force-dynamic";

// The tutor path. Reads { question }, calls the grounding adapter, returns the
// /api/ask contract. Genuine corpus abstention (low_retrieval_score,
// unsupported_premise, ...) stays on HTTP 200 — a refusal is a correct answer.
// Real service failures map to 5xx/4xx (docs/04). NEVER an ungrounded fallback.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST", message: "invalid JSON body" }, { status: 400 });
  }

  const question = (body?.question || "").trim();
  if (!question) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "question is required" }, { status: 400 });
  }

  const result = await ask({ question, k: body?.k ?? 8 });

  // Error → status map (docs/04). These are real failures, distinct from abstention.
  if (result.error === "NO_DOCTRINE_SERVICE") return NextResponse.json(result, { status: 503 });
  if (result.error === "DOCTRINE_UNREACHABLE" || result.error === "DOCTRINE_BAD_RESPONSE") {
    return NextResponse.json(result, { status: 502 });
  }

  // Answered or abstained → 200.
  return NextResponse.json(result, { status: 200 });
}
