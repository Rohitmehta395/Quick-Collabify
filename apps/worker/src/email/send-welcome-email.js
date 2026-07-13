import { sendEmail } from './client.js';
import { generateWelcomeEmailTemplate } from './templates/welcome-email.js';
import { logger } from '@workspace/logger';

/**
 * Generates and sends a Welcome Email to the specified user.
 * Conforms strictly to spec A 4.5 by NEVER storing or logging the interpolated email body.
 *
 * @param {Object} user - The recipient user object
 * @param {string} user.email - User's email address
 * @param {string} [user.displayName] - User's display name
 * @returns {Promise<Object>} The response from the email client
 */
export async function sendWelcomeEmail(user) {
  if (!user || !user.email) {
    throw new Error('User email is required to send a welcome email.');
  }

  // Generate the template (do not log this output!)
  const { subject, htmlBody, textBody } = generateWelcomeEmailTemplate(user);

  try {
    const response = await sendEmail({
      to: user.email,
      subject,
      htmlBody,
      textBody,
    });

    // Log the action abstractly without including raw PII/body content
    logger.info({ userId: user.id, to: user.email }, 'Welcome email sent');
    return response;
  } catch (error) {
    logger.error({ userId: user.id, to: user.email, err: error }, 'Failed to send welcome email');
    throw error;
  }
}
