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
| 1 | Hosting request body | Firebase App Hosting → Cloud Run ingress | **unverified — see below** |
| 2 | `MAX_PDF_BYTES` 50 MiB | `lib/pdf-upload.js`, checked on declared size then on real bytes | set |
| 3 | Parse memory | `quarry.pdfText` holds the buffer plus extracted text | untested at this size |
| 4 | Row size, if the original is retained | `LearningRecord.payload` JSONB | **see "Storing the original"** |
| 5 | `maxDuration = 60` | `app/api/learning/sources/pdf/route.js` | upload + parse must finish inside it |

## 1. The hosting ceiling is real and not yet pinned down

Probing the live backend unauthenticated:

```
1 KB  raw body  -> 401   (reached the application; auth refused it)
8 MB  raw body  -> 500
30 MB raw body  -> 500
40 MB raw body  -> 500
```

A small body reaches the app and is answered by *its* auth check. Larger bodies
do not get that far. Multipart probes at 1/30/45 MB returned connection failures
rather than a status, so the exact boundary and its cause are **not established**
— this could be the Cloud Run ingress, the App Hosting proxy, or the route
buffering the body before auth runs.

**Before promising 50 MiB to anyone, upload a real ~45 MiB PDF as a signed-in
instructor and watch what comes back.** If it fails upstream, the fix is not a
constant: it is a resumable or direct-to-storage upload that never puts the file
in a single request body.

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
