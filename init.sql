CREATE TABLE IF NOT EXISTS public.blogposts (
    post_id SERIAL PRIMARY KEY,
    title VARCHAR(255),
    content TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE,
    user_id INTEGER
);


CREATE TABLE IF NOT EXISTS public.habit_logs (
    id SERIAL PRIMARY KEY,
    habit_id INTEGER,
    user_id INTEGER,
    date DATE,
    status BOOLEAN
);

CREATE TABLE IF NOT EXISTS public.habits (
    id SERIAL PRIMARY KEY,
    habit_name TEXT,
    user_id INTEGER,
    month INTEGER
);


CREATE TABLE IF NOT EXISTS public.health_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    type VARCHAR(50),
    value DOUBLE PRECISION,
    date DATE,
    month INTEGER
);


CREATE TABLE IF NOT EXISTS public.notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    reminder_id INTEGER,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    is_read BOOLEAN
);


CREATE TABLE IF NOT EXISTS public.regis (
    id SERIAL PRIMARY KEY,
    userid VARCHAR(50),
    phone VARCHAR(10),
    email VARCHAR(100),
    password TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE
);


CREATE TABLE IF NOT EXISTS public.reminders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    title TEXT,
    description TEXT,
    event_datetime TIMESTAMP WITH TIME ZONE,
    remind_at TIMESTAMP WITH TIME ZONE,
    sent BOOLEAN,
    email_sent BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE
);
