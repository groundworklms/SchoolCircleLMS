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
| 1 | Hosting request body | Firebase App Hosting → Cloud Run ingress | **documented 32 MiB (HTTP/1); the observed boundary is lower and still unverified — see below** |
| 2 | `MAX_PDF_BYTES` 50 MiB | `lib/pdf-upload.js`, checked on declared size then on real bytes | set |
| 3 | Parse memory | `quarry.pdfText` holds the buffer plus extracted text | untested at this size |
| 4 | Row size, if the original is retained | `LearningRecord.payload` JSONB | **see "Storing the original"** |
| 5 | `maxDuration = 60` | `app/api/learning/sources/pdf/route.js` | upload + parse must finish inside it |

## 1. The hosting ceiling: documented at 32 MiB, real boundary still lower and unpinned

Probing the live backend unauthenticated:

```
1 KB  raw body  -> 401   (reached the application; auth refused it)
8 MB  raw body  -> 500
30 MB raw body  -> 500
40 MB raw body  -> 500
```

A small body reaches the app and is answered by *its* auth check. Larger bodies
do not get that far. Multipart probes at 1/30/45 MB returned connection failures
rather than a status, so **the exact boundary is still not established** — that
has not changed and should not be written down as though it had.

Two things *have* been established since, neither of them by guessing.

**A. The documented platform ceiling is 32 MiB, not 50.** Cloud Run's quota page
states: *"Maximum HTTP/1 request size: 32 MiB per request. Limit applies if using
HTTP/1 server. No limit if using HTTP/2 server."* This is Google's documentation
for the platform App Hosting runs on — it is **not** a measurement of this
backend, and the distinction matters. But it is enough to settle one thing:
`MAX_PDF_BYTES` is 50 MiB, which is **larger than the request the platform will
carry over HTTP/1**. A 50 MiB single-request upload therefore cannot succeed in
production regardless of what the application allows. The app's limit currently
promises 18 MiB more than the transport can deliver.

**B. It is NOT the route buffering the body before auth.** This was one of three
hypotheses; code inspection eliminates it. In `lib/learning/http.js`,
`learningRoute` calls `requireAnyRole(request, roles)` and only *afterwards*
calls `parseBody(...)` — authentication is resolved before the body is touched,
so an unauthenticated request is refused with 401 without the body being read.
That means an unauthenticated probe should return 401 at *any* size, and the
500s above cannot be coming from the application's auth path or from
`MAX_PDF_BYTES` (which is checked later still, inside `createSourceFromPdf`).
**The failure is upstream of the container** — Cloud Run ingress or the App
Hosting proxy.

What remains genuinely unexplained is that the observed failures start at
**8 MB**, far below the documented 32 MiB. So the binding constraint is *not*
the documented one, and the real boundary and its cause are still open. Do not
quote 32 MiB as this deployment's limit; quote it as the platform's documented
maximum and note that something fails earlier.

**Before promising any figure to anyone, upload a real PDF as a signed-in
instructor and watch what comes back** — bisecting upward (4, 8, 16 MB) as an
authenticated user is the missing measurement, and it is cheap compared to
guessing. If it fails upstream, the fix is not a constant: it is a resumable or
direct-to-storage upload that never puts the file in a single request body.

> Side note found while reading the code, relevant to which guard actually
> fires: `learningRoute`'s `maxBodyBytes` option is only enforced on the JSON
> path, which streams and counts bytes in `requestText`. The `body: 'form'`
> path — which is what the PDF route uses — returns `request.formData()`
> directly and does not consult `maxBodyBytes`. PDF uploads are still bounded,
> by `MAX_PDF_BYTES` on `file.size` and then on real byte length, but the
> streaming cap is not the thing bounding them.

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
