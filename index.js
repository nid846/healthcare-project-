import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";
import methodOverride from "method-override";
import multer from "multer";
import fs from "fs";
import { transcribeAudio } from "./services/speechToText.js";
import { parseReminder } from "./services/reminderParser.js";
import { startScheduler } from "./services/reminderScheduler.js";
// 0@gmail.com
// 000000
const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(express.json());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(methodOverride("_method"));

app.use(passport.initialize());
app.use(passport.session());

// PostgreSQL Configuration
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

// Start background reminder scheduler
startScheduler(db);

// Route Handlers
app.get("/", (req, res) => {
  res.render("home.ejs");
});

app.get("/login", (req, res) => {
  res.render("home.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/open", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("open.ejs");
  } else {
    res.redirect("/login");
  }
});

// Logout Route
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Google OAuth Routes
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", {
    successRedirect: "/open",
    failureRedirect: "/login",
  })
);

app.get("/community", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT post_id, title FROM BlogPosts ORDER BY created_at DESC"
    );
    res.render("community.ejs", { posts: result.rows });
  } catch (err) {
    console.error("Error fetching posts:", err);
    res.status(500).send("Error loading posts.");
  }
});

app.get("/post/:id", async (req, res) => {
  const postId = req.params.id;
  try {
    const result = await db.query("SELECT * FROM BlogPosts WHERE post_id = $1", [
      postId,
    ]);
    if (result.rows.length > 0) {
      res.render("post.ejs", { post: result.rows[0] });
    } else {
      res.status(404).send("Post not found.");
    }
  } catch (err) {
    console.error("Error fetching post:", err);
    res.status(500).send("Error loading post.");
  }
});

app.get("/create", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  res.render("create.ejs");
});

// Registration Route
app.post("/register", async (req, res) => {
  const { userid, phone, username: email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.json({
      success: false,
      message: "Passwords do not match. Please try again.",
      class: "alert alert-danger",
    });
  }

  try {
    const checkResult = await db.query("SELECT * FROM regis WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      return res.json({
        success: false,
        message: "Email already registered. Please log in.",
        class: "alert alert-warning",
        redirectUrl: "/login",
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert with created_at handled by PostgreSQL
    await db.query(
      "INSERT INTO regis (userid, phone, email, password) VALUES ($1, $2, $3, $4)",
      [userid, phone, email, hashedPassword]
    );

    res.json({
      success: true,
      message: "Registration successful! Redirecting...",
      class: "alert alert-success",
      redirectUrl: "/login",
    });
  } catch (err) {
    console.error("Error occurred:", err);
    res.json({
      success: false,
      message: "An error occurred. Please try again.",
      class: "alert alert-danger",
    });
  }
});

// Login Route
app.post("/login", async (req, res) => {
  const { username: email, password } = req.body;

  try {
    const result = await db.query("SELECT * FROM regis WHERE email = $1", [
      email,
    ]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const storedPassword = user.password;
      const passwordMatch = await bcrypt.compare(password, storedPassword);

      if (passwordMatch) {
        req.login(user, (err) => {
          if (err) {
            console.error("Login Error:", err);
            return res.json({
              success: false,
              message: "Login error. Please try again.",
              class: "alert alert-danger",
            });
          }
          return res.json({
            success: true,
            message: "Login successful! Redirecting...",
            class: "alert alert-success",
            redirectUrl: "/open",
          });
        });
      } else {
        return res.json({
          success: false,
          message: "Incorrect password. Please try again.",
          class: "alert alert-danger",
        });
      }
    } else {
      return res.json({
        success: false,
        message: "User not found. Please register.",
        class: "alert alert-warning",
      });
    }
  } catch (err) {
    console.error("Error occurred during login:", err);
    res.json({
      success: false,
      message: "An error occurred. Please try again.",
      class: "alert alert-danger",
    });
  }
});

// Local Strategy for Passport
passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM regis WHERE email = $1", [
        username,
      ]);

      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;

        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          }
          if (valid) {
            return cb(null, user);
          } else {
            return cb(null, false, { message: "Incorrect password." });
          }
        });
      } else {
        return cb(null, false, { message: "User not found." });
      }
    } catch (err) {
      console.error("Error verifying user:", err);
      return cb(err);
    }
  })
);

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "ur url",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log("Google Profile:", profile);

        // Correctly retrieve email
        const email = profile.emails[0].value;

        const result = await db.query("SELECT * FROM regis WHERE email = $1", [
          email,
        ]);

        if (result.rows.length === 0) {
          // Insert new Google user with default values for userid and phone
          const newUser = await db.query(
            "INSERT INTO regis (userid, phone, email, password) VALUES ($1, $2, $3, $4) RETURNING *",
            ["google_user", "0000000000", email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          // Return existing user
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        console.error("Google Strategy Error:", err);
        return cb(err);
      }
    }
  )
);

// Serialize and Deserialize User
passport.serializeUser((user, cb) => {
  cb(null, user.id);
});

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await db.query("SELECT * FROM regis WHERE id = $1", [id]);
    if (result.rows.length > 0) {
      cb(null, result.rows[0]);
    } else {
      cb("User not found.");
    }
  } catch (err) {
    cb(err);
  }
});

// Start the Server
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

//TRACKER ------------------------------------------
// ================= ADD HABIT =================
app.post("/add-habit", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  let { habit, month } = req.body;
  const userId = req.user.id;

  month = Number(month);

  try {
    await db.query(
      "INSERT INTO habits (habit_name, user_id, month) VALUES ($1, $2, $3)",
      [habit, userId, month]
    );

    res.redirect(`/tracker?month=${month}`);
  } catch (err) {
    console.error("Error adding habit:", err);
    res.status(500).send("Error adding habit");
  }
});


// ================= ADD HEALTH ENTRY =================
app.post("/add-entry", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  let { type, value, month } = req.body;
  month = Number(month);

  try {
    const now = new Date();

    const year = now.getFullYear();
    const day = String(now.getDate()).padStart(2, '0');
    const realMonth = String(now.getMonth() + 1).padStart(2, '0');

    const formattedDate = `${year}-${realMonth}-${day}`;

    await db.query(
      "INSERT INTO health_entries (user_id, type, value, date) VALUES ($1, $2, $3, $4)",
      [req.user.id, type, value, formattedDate]
    );

    res.redirect(`/tracker?month=${month}`);
  } catch (err) {
    console.error("Error adding entry:", err);
    res.status(500).send("Error adding entry");
  }
});


// ================= TRACKER PAGE =================
app.get("/tracker", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  let selectedMonth = req.query.month || (new Date().getMonth() + 1);
  selectedMonth = Number(selectedMonth);

  try {
    const habits = await db.query(
      "SELECT * FROM habits WHERE user_id=$1 AND month=$2",
      [req.user.id, selectedMonth]
    );

    const logs = await db.query(
      `SELECT * FROM habit_logs 
       WHERE user_id = $1 
       AND EXTRACT(MONTH FROM date) = $2`,
      [req.user.id, selectedMonth]
    );

    const entries = await db.query(
      `SELECT * FROM health_entries 
       WHERE user_id=$1 
       AND EXTRACT(MONTH FROM date) = $2
       ORDER BY date`,
      [req.user.id, selectedMonth]
    );

    res.render("tracker.ejs", {
      habits: habits.rows || [],
      logs: logs.rows || [],
      entries: entries.rows || [],
      selectedMonth
    });

  } catch (err) {
    console.error("Error loading tracker:", err);
    res.status(500).send("Error loading tracker");
  }
});


// ================= DELETE ENTRY =================
app.post("/delete-entry/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const month = Number(req.query.month);

  try {
    await db.query(
      "DELETE FROM health_entries WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );

    res.redirect(`/tracker?month=${month}`);
  } catch (err) {
    console.error("Error deleting entry:", err);
    res.status(500).send("Error deleting entry");
  }
});


// ================= DELETE HABIT =================
app.post("/delete-habit/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const month = Number(req.query.month);

  try {
    await db.query(
      "DELETE FROM habits WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );

    res.redirect(`/tracker?month=${month}`);
  } catch (err) {
    console.error("Error deleting habit:", err);
    res.status(500).send("Error deleting habit");
  }
});


// ================= UPDATE HABIT (🔥 MOST IMPORTANT FIX) =================
app.post("/update-habit", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const { habitId, day, status, month } = req.body;
  const userId = req.user.id;

  const year = new Date().getFullYear();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  try {
    // 🔥 UPSERT (insert or update)
    await db.query(`
      INSERT INTO habit_logs (habit_id, user_id, date, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (habit_id, date)
      DO UPDATE SET status = EXCLUDED.status
    `, [habitId, userId, date, status]);

    res.json({ success: true });

  } catch (err) {
    console.error("Error updating habit:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// BLOGPOSTS --------------------------------------------------
app.post("/create", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  const { title, content } = req.body;

  try {
    const userId = req.user.id;

    await db.query(
      "INSERT INTO BlogPosts (title, content, user_id) VALUES ($1, $2, $3)",
      [title, content, userId]
    );

    res.redirect("/community");
  } catch (err) {
    console.error("Error adding post:", err);
    res.status(500).send("Error creating post.");
  }
});

app.delete("/delete/:id", async (req, res) => {
  const postId = req.params.id;
  try {
    await db.query("DELETE FROM BlogPosts WHERE post_id = $1", [postId]);
    res.redirect("/community");
  } catch (err) {
    console.error("Error deleting post:", err);
    res.status(500).send("Error deleting post.");
  }
});

//locator
app.get("/locator", (req, res) => {
  res.render("locator.ejs");
});

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ================= RESOURCES / VOICE REMINDER FEATURE =================

// Multer Upload Configuration
const upload = multer({
  dest: "public/uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    // Enforce audio/webm and audio/wav only (Chrome can send video/webm or audio/webm)
    const allowedMimeTypes = ["audio/webm", "video/webm", "audio/wav", "application/octet-stream"];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Accepted formats: audio/webm and audio/wav only"));
    }
  }
});

// 1. GET /resources
app.get("/resources", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  try {
    // Fetch upcoming reminders grouped by event, sorted by event_datetime nearest first
    const remindersResult = await db.query(
      `SELECT MIN(id) as id, title, event_datetime 
       FROM reminders 
       WHERE user_id = $1 AND event_datetime > NOW()
       GROUP BY title, event_datetime
       ORDER BY event_datetime ASC`,
      [req.user.id]
    );

    // Fetch user notifications triggered, ordered latest first
    const notificationsResult = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.render("resources.ejs", {
      reminders: remindersResult.rows || [],
      notifications: notificationsResult.rows || [],
      user: req.user
    });
  } catch (err) {
    console.error("Error loading resources:", err);
    res.status(500).send("Error loading resources.");
  }
});

// 2. POST /resources/voice
app.post("/resources/voice", upload.single("audio"), async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: "We couldn't hear anything — please try recording again." });
  }

  // Server-side verification of audio format
  const allowedMimeTypes = ["audio/webm", "video/webm", "audio/wav", "application/octet-stream"];
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    try {
      await fs.promises.unlink(req.file.path);
    } catch { }
    return res.status(400).json({ success: false, message: "Accepted formats: audio/webm and audio/wav only" });
  }

  try {
    // Send audio to STT
    const transcript = await transcribeAudio(req.file.path, req.file.mimetype);

    // Parse transcript to extract title and date/time components
    const parsedResult = await parseReminder(transcript);

    if (!parsedResult.success) {
      return res.status(400).json(parsedResult);
    }

    return res.json(parsedResult);
  } catch (err) {
    console.error("Voice processing error:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to process your voice recording. Please try again."
    });
  } finally {
    // Always discard the uploaded temp audio file
    if (req.file && req.file.path) {
      try {
        await fs.promises.unlink(req.file.path);
        console.log(`[STT] Cleaned up temp upload file: ${req.file.path}`);
      } catch (unlinkErr) {
        console.error("Failed to clean up temp file:", unlinkErr.message);
      }
    }
  }
});

// 2b. POST /resources/text  ← text input fallback, same parser as voice
app.post("/resources/text", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }

  // Validate and sanitise the incoming text
  const raw = req.body.text;
  if (!raw || typeof raw !== "string") {
    return res.status(400).json({ success: false, message: "Please provide reminder text." });
  }
  const text = raw.trim();
  if (text.length === 0) {
    return res.status(400).json({ success: false, message: "Reminder text cannot be empty." });
  }
  const MAX_TEXT_LEN = 500;
  if (text.length > MAX_TEXT_LEN) {
    return res.status(400).json({
      success: false,
      message: `Reminder text is too long (max ${MAX_TEXT_LEN} characters).`
    });
  }

  // Feed directly into the COMMON reminder parser — identical to the voice path
  try {
    const parsedResult = await parseReminder(text);
    if (!parsedResult.success) {
      return res.status(400).json(parsedResult);
    }
    return res.json(parsedResult);
  } catch (err) {
    console.error("Text reminder parsing error:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to process your reminder text. Please try again."
    });
  }
});

// 3. POST /resources/reminders
app.post("/resources/reminders", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }

  const { title, event_datetime } = req.body;
  if (!title || !event_datetime) {
    return res.status(400).json({ success: false, message: "Missing title or event date/time." });
  }

  const eventTime = new Date(event_datetime);
  if (isNaN(eventTime.getTime())) {
    return res.status(400).json({ success: false, message: "Invalid date/time format." });
  }

  const now = new Date();
  if (eventTime <= now) {
    return res.status(400).json({ success: false, message: "That date/time has already passed — please provide a future date and time." });
  }

  const userId = req.user.id;

  // Calculate default reminder times:
  // 3 days before, 1 day before, 1 hour before
  const offsets = [
    { label: "3 days before", time: new Date(eventTime.getTime() - 3 * 24 * 60 * 60 * 1000) },
    { label: "1 day before", time: new Date(eventTime.getTime() - 1 * 24 * 60 * 60 * 1000) },
    { label: "1 hour before", time: new Date(eventTime.getTime() - 1 * 60 * 60 * 1000) }
  ];

  // Filter out past reminder times
  const validOffsets = offsets.filter(offset => offset.time > now);

  // If all offset times are in the past there is nothing to schedule.
  // (The event itself is still in the future but all reminder triggers have passed.)
  // Tell the user instead of silently creating nothing.
  const reminderTimes = validOffsets.map(o => o.time);
  if (reminderTimes.length === 0) {
    return res.status(400).json({
      success: false,
      message: "All reminder times for this event are already in the past. Try scheduling an event further in the future."
    });
  }

  // Insert reminder rows transactionally
  try {
    await db.query("BEGIN");

    for (const remindAt of reminderTimes) {
      await db.query(
        `INSERT INTO reminders (user_id, title, event_datetime, remind_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, title, eventTime, remindAt]
      );
    }

    await db.query("COMMIT");
    return res.json({ success: true, message: "Reminder successfully scheduled!" });
  } catch (dbErr) {
    await db.query("ROLLBACK");
    console.error("Database transaction failure during confirm:", dbErr);
    return res.status(500).json({ success: false, message: "Database failure during confirm." });
  }
});

// 4. DELETE /resources/reminders/:id
app.delete("/resources/reminders/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send("Unauthorized");
  }

  const reminderId = parseInt(req.params.id);
  if (isNaN(reminderId)) {
    return res.status(404).send("Reminder not found.");
  }

  try {
    // 1. Fetch details of target reminder first, ensuring it belongs to current user
    const checkResult = await db.query(
      "SELECT title, event_datetime FROM reminders WHERE id = $1 AND user_id = $2",
      [reminderId, req.user.id]
    );

    if (checkResult.rows.length === 0) {
      // 404 (not 403) to avoid confirming existence
      return res.status(404).send("Reminder not found.");
    }

    const { title, event_datetime } = checkResult.rows[0];

    // 2. Delete all rows sharing the event title and event_datetime for this user
    await db.query(
      "DELETE FROM reminders WHERE user_id = $1 AND title = $2 AND event_datetime = $3",
      [req.user.id, title, event_datetime]
    );

    res.redirect("/resources");
  } catch (err) {
    console.error("Error deleting reminder:", err);
    res.status(500).send("Error deleting reminder.");
  }
});



