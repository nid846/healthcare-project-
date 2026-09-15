import fs from "fs";

/**
 * Transcribes audio using Groq Speech-to-Text (Whisper).
 * Falls back to Gemini if Groq encounters a 429 rate limit or server outage (5xx/timeout).
 * 
 * @param {string} filePath - Path to the local temporary audio file
 * @param {string} mimeType - The mime type of the audio file (e.g. audio/webm or audio/wav)
 * @returns {Promise<string>} The transcribed text
 */
export async function transcribeAudio(filePath, mimeType) {
  try {
    console.log(`[STT] Attempting transcription with Groq (Model: whisper-large-v3-turbo) for file: ${filePath}`);
    return await transcribeWithGroq(filePath, mimeType);
  } catch (err) {
    console.error("[STT] Groq transcription failed:", err.message);
    
    // Check if the failure warrants a fallback (429 or 5xx/network/timeout)
    const status = err.status;
    const isRateLimit = status === 429;
    const isOutage = !status || status >= 500; // No status indicates a network or timeout error
    
    if (isRateLimit || isOutage) {
      console.log(`[STT] Triggering Gemini fallback transcription. (Reason: Status ${status || "Network Timeout"})`);
      try {
        return await transcribeWithGemini(filePath, mimeType);
      } catch (geminiErr) {
        console.error("[STT] Gemini fallback transcription also failed:", geminiErr.message);
        throw new Error("Both Groq and Gemini transcription failed.");
      }
    } else {
      // For other client errors, propagate the original error
      throw err;
    }
  }
}

async function transcribeWithGroq(filePath, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not defined in environment variables.");
  }

  const formData = new FormData();
  const fileBuffer = await fs.promises.readFile(filePath);
  
  // Choose standard file extension
  const ext = mimeType.includes("wav") ? "wav" : "webm";
  // Create File object for FormData
  const file = new File([fileBuffer], `audio.${ext}`, { type: mimeType });
  
  formData.append("file", file);
  formData.append("model", "whisper-large-v3-turbo");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Groq API Error: ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (!data.text) {
    throw new Error("Groq returned an empty transcription response.");
  }
  return data.text.trim();
}

async function transcribeWithGemini(filePath, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables.");
  }

  const fileBuffer = await fs.promises.readFile(filePath);
  const base64Data = fileBuffer.toString("base64");

  // Normalize mime type for Gemini (strip codecs parameter if present)
  const normalizedMimeType = mimeType.split(";")[0].trim();

  const payload = {
    contents: [
      {
        parts: [
          { text: "Transcribe this audio file exactly as spoken. Output ONLY the transcribed text. Do not add any introduction, greeting, or explanation. If there is no audible speech, respond with an empty string." },
          {
            inline_data: {
              mime_type: normalizedMimeType,
              data: base64Data
            }
          }
        ]
      }
    ]
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Gemini API Error: ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) {
    throw new Error("Gemini returned a response structure without parsed text parts.");
  }
  return text.trim();
}
