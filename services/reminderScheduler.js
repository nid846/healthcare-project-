import cron from "node-cron";
import { sendReminderEmail } from "./emailService.js";
import { formatKolkataDateTime } from "./reminderParser.js";

/**
 * Initializes and starts the background reminder scheduler cron job.
 * Runs every minute to find and process due reminders.
 * 
 * @param {object} db - The connected PostgreSQL client or pool
 */
export function startScheduler(db) {
  console.log("[Scheduler] Initializing background reminder cron scheduler (runs every minute).");
  
  // Run every minute: * * * * *
  cron.schedule("* * * * *", async () => {
    console.log("[Scheduler] Tick: checking for due reminders...");
    try {
      // 1. Claim and fetch due reminders atomically using FOR UPDATE SKIP LOCKED
      const claimQuery = `
        WITH claimed AS (
          UPDATE reminders
          SET sent = true
          WHERE id IN (
            SELECT id FROM reminders
            WHERE remind_at <= NOW() AND sent = false
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *
        )
        SELECT c.*, r.email 
        FROM claimed c
        JOIN regis r ON c.user_id = r.id;
      `;

      const result = await db.query(claimQuery);
      const claimedReminders = result.rows || [];

      if (claimedReminders.length > 0) {
        console.log(`[Scheduler] Atomically claimed ${claimedReminders.length} due reminder(s) for processing.`);
        
        for (const reminder of claimedReminders) {
          try {
            // 2. Create the in-app notification row
            const formattedEventTime = formatKolkataDateTime(new Date(reminder.event_datetime));
            const message = `Reminder: "${reminder.title}" scheduled for ${formattedEventTime}`;
            
            await db.query(
              `INSERT INTO notifications (user_id, reminder_id, message) 
               VALUES ($1, $2, $3)`,
              [reminder.user_id, reminder.id, message]
            );
            console.log(`[Scheduler] Created in-app notification for reminder ID: ${reminder.id}`);

            // 3. Dispatch the email via Resend
            const emailSuccess = await sendReminderEmail(reminder.email, reminder.title, reminder.event_datetime);
            
            // 4. Update the email_sent column if successful
            if (emailSuccess) {
              await db.query(
                "UPDATE reminders SET email_sent = true WHERE id = $1",
                [reminder.id]
              );
              console.log(`[Scheduler] Marked email_sent = true for reminder ID: ${reminder.id}`);
            } else {
              console.log(`[Scheduler] Email failed for reminder ID: ${reminder.id}. email_sent left as false.`);
            }
          } catch (itemErr) {
            console.error(`[Scheduler] Error processing claimed reminder ID ${reminder.id}:`, itemErr.message);
          }
        }
      }
    } catch (err) {
      console.error("[Scheduler] Error occurred during reminder cron run:", err.message);
    }
  });
}
