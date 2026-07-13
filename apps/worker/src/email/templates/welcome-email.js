/**
 * Generates the subject and body components for a Welcome Email.
 *
 * @param {Object} user
 * @param {string} user.email
 * @param {string} [user.displayName]
 * @returns {{ subject: string, htmlBody: string, textBody: string }}
 */
export function generateWelcomeEmailTemplate(user) {
  const name = user.displayName || 'there';

  const subject = `Welcome to Quick Collabify, ${name}!`;

  const htmlBody = `
    <h1>Welcome to Quick Collabify!</h1>
    <p>Hi ${name},</p>
    <p>We're thrilled to have you on board. Quick Collabify is your new workspace for real-time collaboration.</p>
    <p>If you have any questions or need help getting started, just reply to this email!</p>
    <br>
    <p>Cheers,</p>
    <p>The Quick Collabify Team</p>
  `;

  const textBody = `Welcome to Quick Collabify!\n\nHi ${name},\n\nWe're thrilled to have you on board. Quick Collabify is your new workspace for real-time collaboration.\n\nIf you have any questions or need help getting started, just reply to this email!\n\nCheers,\nThe Quick Collabify Team`;

  return { subject, htmlBody, textBody };
}
