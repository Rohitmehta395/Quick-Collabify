import { ServerClient } from 'postmark';
import { loadConfig, workerEnvSchema } from '@workspace/config';
import { logger } from '@workspace/logger';

const config = loadConfig(workerEnvSchema);
const client = new ServerClient(config.POSTMARK_API_KEY);

/**
 * Sends a generic transactional email via Postmark.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlBody - HTML version of the body
 * @param {string} [options.textBody] - Optional plain text version
 * @returns {Promise<Object>} The response from Postmark API
 */
export async function sendEmail({ to, subject, htmlBody, textBody }) {
  try {
    const response = await client.sendEmail({
      From: config.EMAIL_FROM_ADDRESS,
      To: to,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
    });

    logger.info({ messageId: response.MessageID, to }, 'Email sent successfully via Postmark');
    return response;
  } catch (error) {
    // Scrub sensitive HTTP config/response data from the error before logging or throwing it
    // to prevent accidental leakage of API keys in upstream error handlers (e.g. BullMQ, other logs).
    if (error.config) delete error.config;
    if (error.request) delete error.request;
    if (error.response) {
      // Keep only safe response data if needed, or delete entirely
      error.postmarkErrorCode = error.response.data?.ErrorCode;
      error.postmarkMessage = error.response.data?.Message;
      delete error.response;
    }

    logger.error({ err: error, to }, 'Failed to send email via Postmark');
    throw error;
  }
}
