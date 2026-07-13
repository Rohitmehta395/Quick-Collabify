# Background Worker Service

The asynchronous background job processor for the workspace, built using BullMQ and Redis.

## Responsibilities

- Execute heavy or non-blocking tasks out-of-band (e.g., email notifications, document exports, cache warming).
- Consume jobs queued by the API or Realtime services via Redis.

## Commands

- `pnpm dev`: Start the worker process in watch mode.
- `pnpm start`: Start the compiled production worker process.

## Local Setup & Testing

To fully test background email jobs locally, you must supply an email provider API key.

1. **Obtain a Postmark API Key:**
   - Sign up for a [Postmark account](https://postmarkapp.com/) (they offer a developer/sandbox mode).
   - Create a new "Server" (Postmark's terminology for an isolated environment).
   - Go to the **API Tokens** tab and copy your Server API token.
   - Add it to your root `.env` file as `POSTMARK_API_KEY`.
   - Ensure `EMAIL_FROM_ADDRESS` in `.env` is set to the sender address associated with your Postmark account.
2. **Verify the Worker:**
   - Ensure Redis is running (start it via Docker Compose from the project root).
   - Start the workspace development servers (`pnpm dev` from root).
   - Trigger the welcome email job by signing into the app for the very first time using OAuth.
   - The worker terminal output will log `Job completed successfully` if everything is configured correctly.
