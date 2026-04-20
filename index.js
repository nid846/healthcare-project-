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

// app.get("/create", (req, res) => {
//     res.render("create.ejs");
// });

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



