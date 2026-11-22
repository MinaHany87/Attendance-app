-- Run this once in your Netlify Database console (or any Postgres client connected to it).

CREATE TABLE IF NOT EXISTS employees (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Names must be unique (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS employees_name_unique ON employees (lower(name));

CREATE TABLE IF NOT EXISTS attendance (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  work_date     DATE NOT NULL,            -- Cairo calendar date
  check_in_at   TIMESTAMPTZ,              -- stored in UTC
  check_out_at  TIMESTAMPTZ,              -- stored in UTC
  hours_worked  NUMERIC(6,2),             -- decimal hours
  alert_message TEXT,                     -- e.g. "Less than 8 hours"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_one_per_day UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_work_date_idx ON attendance (work_date);

CREATE TABLE IF NOT EXISTS attendance_edits (
  id            SERIAL PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id),
  field_changed TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  edited_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
