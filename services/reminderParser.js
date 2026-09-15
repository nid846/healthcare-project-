import * as chrono from "chrono-node";

/**
 * Gets the current date/time in Asia/Kolkata timezone represented as a local system Date object.
 * This is used as the reference date for chrono-node to resolve relative dates correctly.
 */
export function getKolkataRefDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));

  return new Date(
    parseInt(partMap.year),
    parseInt(partMap.month) - 1,
    parseInt(partMap.day),
    parseInt(partMap.hour),
    parseInt(partMap.minute),
    parseInt(partMap.second)
  );
}

/**
 * Converts a face-value Date (resolved relative to Kolkata) back to an absolute UTC Date.
 * 
 * @param {Date} parsedDate - The face-value Date returned by chrono-node
 * @returns {Date} The absolute UTC Date object
 */
export function convertKolkataToUTC(parsedDate) {
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  const hour = String(parsedDate.getHours()).padStart(2, '0');
  const minute = String(parsedDate.getMinutes()).padStart(2, '0');
  const second = String(parsedDate.getSeconds()).padStart(2, '0');

  // Kolkata is UTC+05:30 (and does not observe DST)
  const kolkataIsoStr = `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
  return new Date(kolkataIsoStr);
}

/**
 * Formats a Date object as a display string in Asia/Kolkata timezone.
 * E.g., "August 31, 2026 at 5:00 PM"
 * 
 * @param {Date} date - The UTC Date object
 * @returns {string} The formatted string in Asia/Kolkata timezone
 */
export function formatKolkataDateTime(date) {
  return date.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    dateStyle: "long",
    timeStyle: "short"
  });
}

/**
 * Extracts the title and dates from transcript using chrono-node,
 * falling back to Gemini JSON extraction if chrono-node yields no results.
 * 
 * @param {string} transcript - The user voice transcript text
 * @returns {Promise<Object>} An object containing validation status or the parsed results
 */
export async function parseReminder(transcript) {
  if (!transcript || !transcript.trim()) {
    return {
      success: false,
      errorType: "EMPTY_TRANSCRIPT",
      message: "We couldn't hear anything — please try recording again."
    };
  }

  const refDate = getKolkataRefDate();
  
  // 1. Try parsing with chrono-node
  let results = chrono.parse(transcript, refDate);
  let parsedDate = null;
  let hasDate = false;
  let hasTime = false;
  let title = "";

  if (results.length > 0) {
    const result = results[0];
    parsedDate = result.date();
    
    // Check which components were explicitly parsed
    hasDate = result.start.isCertain('day') || result.start.isCertain('month') || result.start.isCertain('weekday');
    hasTime = result.start.isCertain('hour');
    title = cleanTitle(transcript, results);
  } else {
    // 2. Fallback to Gemini parsing if chrono-node finds nothing
    console.log("[Parser] Chrono-node found no date/time, trying Gemini fallback.");
    const refDateStr = formatKolkataDateTime(new Date());
    const geminiParsed = await parseWithGemini(transcript, refDateStr);
    
    if (geminiParsed) {
      title = geminiParsed.title || "Voice Reminder";
      hasDate = !!geminiParsed.date;
      hasTime = !!geminiParsed.time;
      
      if (hasDate && hasTime) {
        // Construct the face-value Date
        parsedDate = new Date(`${geminiParsed.date}T${geminiParsed.time}:00`);
      } else if (hasDate) {
        parsedDate = new Date(`${geminiParsed.date}T12:00:00`); // Implied time for validation
      } else if (hasTime) {
        // Use reference date's day/month/year with the parsed time
        const y = refDate.getFullYear();
        const m = String(refDate.getMonth() + 1).padStart(2, '0');
        const d = String(refDate.getDate()).padStart(2, '0');
        parsedDate = new Date(`${y}-${m}-${d}T${geminiParsed.time}:00`);
      }
    }
  }

  // 3. Validation Logic
  if (!hasDate && !hasTime) {
    return {
      success: false,
      errorType: "NO_DATETIME",
      message: "I couldn't determine the appointment date and time. Please mention both clearly."
    };
  }

  if (hasDate && !hasTime) {
    return {
      success: false,
      errorType: "MISSING_TIME",
      message: "I found the date, but please specify the time of the appointment."
    };
  }

  if (!hasDate && hasTime) {
    return {
      success: false,
      errorType: "MISSING_DATE",
      message: "I found the time, but please specify the date of the appointment."
    };
  }

  // 4. Past Date Check
  const utcEventDate = convertKolkataToUTC(parsedDate);
  const now = new Date();
  if (utcEventDate <= now) {
    return {
      success: false,
      errorType: "PAST_DATETIME",
      message: "That date/time has already passed — please provide a future date and time."
    };
  }

  // Formatting date and time for confirmation screen
  const displayDate = utcEventDate.toLocaleDateString("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const displayTime = utcEventDate.toLocaleTimeString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  return {
    success: true,
    title,
    event_datetime: utcEventDate.toISOString(),
    displayDate,
    displayTime
  };
}

/**
 * Cleans the event title by removing matched date/time sub-strings and common prepositions.
 */
function cleanTitle(transcript, results) {
  let title = transcript;
  for (const res of results) {
    title = title.replace(res.text, "");
  }
  // Remove common prepositions and connectors associated with date/time
  title = title.replace(/\b(at|on|for|in|by|around|tomorrow|today|yesterday)\b/gi, "");
  // Remove extra spaces and leading/trailing punctuation
  title = title.replace(/\s+/g, " ").trim();
  title = title.replace(/^[,.\s-]+|[,.\s-]+$/g, "");
  
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  return title;
}

/**
 * Helper to parse transcript with Gemini API in structured JSON.
 * Fails gracefully and returns null on error.
 */
async function parseWithGemini(transcript, refDateStr) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[Parser] GEMINI_API_KEY is not defined, skipping Gemini fallback.");
    return null;
  }

  const prompt = `You are a date and time extraction assistant.
Analyze the following user transcript: "${transcript}"
Current reference date and time in Kolkata (Asia/Kolkata): ${refDateStr}

Extract the event title, the event date, and the event time.
Output MUST be a valid JSON object matching this schema:
{
  "title": "string or null",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM (24-hour format) or null"
}
Do not include any markdown formatting, preamble, or code block wrapper. Just output raw JSON.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      console.error("[Parser] Gemini fallback API returned error status:", response.status);
      return null;
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) return null;

    // Clean markdown code blocks if the model outputs them
    const jsonStr = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("[Parser] Gemini fallback parsing failed:", err.message);
    return null; // Graceful fallback to return null (which triggers NO_DATETIME error)
  }
}
