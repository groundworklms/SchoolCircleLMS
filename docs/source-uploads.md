# Source PDF uploads — the size ceilings

Corpus ingestion deals in whole publications. A T&R manual or an infantry MCRP
routinely runs past 10 MiB, so the application guard is **50 MiB**
(`MAX_PDF_BYTES`, `lib/pdf-upload.js`).

**That is the application's limit, not the only one.** A PDF has to clear every
ceiling below, and the smallest one wins. Raising `MAX_PDF_BYTES` alone does not
make a 50 MiB upload succeed in production.

## The chain, in the order a file meets it

| # | Ceiling | Where | Status |
|---|---|---|---|
| 1 | Hosting request body | Firebase App Hosting → Cloud Run ingress | documented **32 MiB** (HTTP/1) — but see below: the practical cut is the **60 s route budget vs upload speed**, which is client-dependent |
| 2 | `MAX_PDF_BYTES` 50 MiB | `lib/pdf-upload.js`, checked on declared size then on real bytes | set |
| 3 | Parse memory | `quarry.pdfText` holds the buffer plus extracted text | untested at this size |
| 4 | Row size, if the original is retained | `LearningRecord.payload` JSONB | **see "Storing the original"** |
| 5 | `maxDuration = 60` | `app/api/learning/sources/pdf/route.js` | upload + parse must finish inside it — **measured to be the real binding limit on a slow uplink** |

## 1. The hosting ceiling — measured 17 Sep 2026, and it is not a byte limit

**The "8 MB" boundary this file used to report does not exist.** Re-probed against the
live backend (`https://schoolcircle.tannerwhite.net/api/learning/sources/pdf`,
unauthenticated, raw `application/pdf` bodies):

| Body | Result | Elapsed |
|---|---|---|
| 1 KB | **401** | 0.4 s |
| 1 MiB | **401** | 1.8 s |
| 2 MiB | **401** | 3.8 s |
| 4 MiB | **401** | 9.9 s |
| 8 MiB | **500**, then **401 · 401 · 401** on three repeats | 17 s / 10–22 s |
| 16 MiB | **401** | 26 s |
| 24 MiB | **401** | 56 s |
| 28 MiB | **500** | 59 s |
| 30 MiB | **500** | 44 s |
| 31 MiB | **500** | 61 s |
| 32 MiB | **500** | 77 s |
| 33 MiB | **500** | 69 s |
| 40 MiB | **500** | 57 s |

Two conclusions, and the first invalidates the old table.

**A. The results are not monotonic, so size alone is not the discriminator.** 8 MiB returned
500 once and then 401 three times in a row, while 16 MiB and 24 MiB — both larger — were
answered by the application's auth check. A single 500 at 8 MiB was transient (cold start or
instance pressure), and the previous revision of this file recorded it as a ceiling. It is not
one. **Do not quote an 8 MB limit.**

**B. What actually correlates is elapsed time, not bytes.** Upload throughput from this laptop
measured roughly **0.4–0.6 MB/s**, and the failures begin exactly where the request crosses
about **60 seconds**: 24 MiB took 56 s and succeeded, 28 MiB took 59 s and failed, and
everything above failed. The route declares `maxDuration = 60`
(`app/api/learning/sources/pdf/route.js`). So on this path the binding constraint is **the
60-second route budget racing the upload**, not a byte ceiling.

That is a worse property than a fixed limit, because it is **client-dependent**: the same PDF
succeeds on a fast uplink and fails on a hotel wifi. There is no single "max MiB" to publish.
A 24 MiB file that works from the office can fail from the venue.

**Caveat on the mechanism.** The 60 s correlation is inferred from response timing, not read
from a server log — I did not have access to Cloud Run request logs, and a 500 does not say
which layer produced it. The correlation is strong and the `maxDuration` value matches, but if
you can read the logs, confirm it before treating it as settled.

**Still above all of this: Cloud Run documents a hard 32 MiB HTTP/1 request limit** —
*"Maximum HTTP/1 request size: 32 MiB per request. Limit applies if using HTTP/1 server. No
limit if using HTTP/2 server."* That is Google's documentation for the platform App Hosting
runs on, not a measurement of this backend. It matters anyway, because **`MAX_PDF_BYTES` is
50 MiB — larger than the request the platform will carry.** A 50 MiB single-request upload
cannot succeed in production no matter what the application allows. The app's guard currently
promises 18 MiB more than the transport can deliver.

**C. It is NOT the route buffering the body before auth.** This was one of three hypotheses;
code inspection eliminates it. In `lib/learning/http.js`, `learningRoute` calls
`requireAnyRole(request, roles)` and only *afterwards* calls `parseBody(...)` — auth resolves
before the body is touched, which is why every probe above that reached the app returned 401
rather than a size error, at any size. `MAX_PDF_BYTES` is checked later still, inside
`createSourceFromPdf`.

### What is still unverified

The **authenticated** path. Every probe above stops at the 401, so nothing here exercises
parsing, `MAX_PDF_BYTES`, or the Quarry parse memory in ceiling #3. **Before promising any
figure to anyone, upload a real ~20 MiB PDF as a signed-in instructor and watch what comes
back** — that is the one measurement still missing, and it is cheap.

The honest current answer to "what is the limit?" is: *the application allows 50 MiB, the
platform will not carry more than 32 MiB, and in practice the 60-second route budget cuts it
lower than that on a slow connection.* If whole publications must be ingested reliably, the
fix is not a constant — it is a resumable or direct-to-storage upload that never puts the file
in a single request body, which also removes the bandwidth dependency.

## Storing the original

If a change retains the original file (rather than only its extracted text),
where it goes matters more at 50 MiB than at 10.

Base64 inside `LearningRecord.payload` costs about **1.34×** the file — a 50 MiB
PDF becomes ~67 MB in a JSONB column, and every read that touches that row
materialises the whole string plus the decoded buffer. That is workable for a
handful of small files and needs no migration, which is why it is tempting. It
is not a good home for a corpus of whole publications.

Object storage with the record holding only a reference is the right shape at
this size. Until then, prefer selecting the id rather than the payload whenever
the bytes are not actually needed.

## What the guard checks

`readPdfUpload` refuses, in order: a non-`application/pdf` MIME type, a declared
size over the limit (before reading the body, so an oversized upload is not
allocated), real bytes over the limit after reading (a lying `Content-Length`
does not get through), and a missing `%PDF-` signature. The parser never
receives an unchecked upload.
