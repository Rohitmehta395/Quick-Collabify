# 7. Use Postmark for Transactional Emails

Date: 2026-07-14
Status: Accepted

## Context

For our background job infrastructure (Phase 2), we need to send transactional emails (starting with a welcome email). We need an email provider that supports high deliverability, structured API responses for error handling and logging, and cleanly separates transactional streams from marketing streams. Given our strict security and logging requirements (spec §11.2, no raw provider errors or secrets logged), the provider's SDK and error structures must be predictable and manageable.

## Decision

We will use **Postmark** as our transactional email provider.

## Consequences

- **Pros:**
  - High deliverability with a strict requirement to separate transactional and broadcast streams.
  - Well-documented API and Node.js SDK (`postmark`) which makes structured error handling straightforward.
  - Clear, distinct error codes that allow us to map failures into our own logging categorization without dumping raw HTTP responses.
- **Cons:**
  - Requires active management of API keys in our environment and configuration schema.
  - Raw SDK errors often embed the original HTTP request and response (including headers with the API key), which requires our worker code to explicitly scrub the error objects before passing them to our Pino logger to avoid violating security logging constraints.
