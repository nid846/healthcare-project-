import { Resend } from "resend";
import { formatKolkataDateTime } from "./reminderParser.js";

/**
 * Dispatches an email notification to the user using the Resend service.
 * Handles any failure gracefully by logging it without crashing.
 * 
 * @param {string} toEmail - Recipient user email
 * @param {string} title - Reminder title
 * @param {Date} eventDatetime - The original event date/time
 * @returns {Promise<boolean>} True if sent successfully, false otherwise
 */

export async function sendReminderEmail(toEmail, title, eventDatetime) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[EmailService] RESEND_API_KEY is not defined in environment variables. Cannot send email.");
    return false;
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const formattedTime = formatKolkataDateTime(new Date(eventDatetime));

  const resend = new Resend(apiKey); // creates resend client

  try {
    console.log(`[EmailService] Attempting to send email via Resend from ${fromEmail} to ${toEmail} for event: "${title}"`);
    const response = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Curanet Reminder: ${title}`,
      html: `
        <div style="font-family: 'Lucida Sans', Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f7fafc;">
          <h2 style="color: #043a60; border-bottom: 2px solid #7fbae1; padding-bottom: 10px; margin-top: 0;">Curanet Voice Reminder</h2>
          <p style="font-size: 16px; color: #2d3748; line-height: 1.5;">This is an automated reminder from your Curanet health assistant.</p>
          <div style="background-color: #ffffff; padding: 15px; border-radius: 6px; border-left: 4px solid #3182ce; margin: 20px 0;">
            <p style="margin: 0; font-size: 15px; color: #4a5568;"><strong>Event:</strong> ${title}</p>
            <p style="margin: 5px 0 0 0; font-size: 15px; color: #4a5568;"><strong>Scheduled For:</strong> ${formattedTime}</p>
          </div>
          <p style="font-size: 14px; color: #718096; margin-top: 20px; text-align: center; border-top: 1px solid #edf2f7; padding-top: 15px;">
            Stay healthy, stay cared.<br>
            <strong>Curanet Healthcare App</strong>
          </p>
        </div>
      `
    });

    if (response.error) {
      console.error(`[EmailService] Resend API returned error:`, response.error);
      return false;
    }

    console.log(`[EmailService] Email successfully dispatched. Message ID: ${response.data?.id}`);
    return true;
  } catch (err) {
    console.error("[EmailService] Failed to send email due to an exception:", err.message);
    return false; // Fail gracefully
  }
}
