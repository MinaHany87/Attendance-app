# Office Attendance App - Mina Hany Unlimited Care

Web app for employee check-in and check-out, with same-day editing, a personal history, a monthly summary, and an Excel export for HR. Times use the **Africa/Cairo** timezone.

## What's included

```
attendance-app/
├── netlify.toml                 # Netlify build and /api routing
├── package.json                 # Dependencies (pg, exceljs)
├── db/schema.sql                # Database tables (run once)
├── netlify/functions/api.js     # All server logic (API)
└── public/
    ├── index.html, app.js       # Employee page
    ├── hr.html, hr.js           # HR page (employees + Excel export)
    ├── common.js                # Shared helpers
    ├── styles.css               # Brand colors and layout
    └── logo.png                 # Office logo (you must add this file - see step 2)
```

## Features

- **Name-only identification:** employees pick their name from a list. No IDs, emails, or personal passwords.
- **One shared PIN:** the employee page and the HR page both ask for the same PIN.
- **Check-in / check-out:** one of each per day. Times are recorded automatically.
- **8-hour alert:** if check-out happens with less than 8 hours worked, the employee sees a warning. The check-out is still saved and the alert is stored.
- **Same-day edits only:** employees can correct today's times. Past records are locked on the server, and every edit is logged.
- **Own history only:** each employee sees only their own records, with the month-to-date total and the total ÷ 26.
- **HR page:** add, rename, activate, or deactivate employees, and download an Excel file with name, date, check-in, check-out, hours, and alert columns.

## Setup

### Step 1: Create the database

1. In Netlify, create a new site and add a **Netlify Database** to it (or use any Postgres database you can connect to).
2. Open the database's SQL console and run the contents of `db/schema.sql`.
3. Copy the database connection string. Netlify normally sets it as the `NETLIFY_DATABASE_URL` environment variable. The app also accepts `DATABASE_URL`.

### Step 2: Add the logo

Copy the logo file to `public/logo.png`.

### Step 3: Deploy to Netlify

Either option works:

- **Option A (GitHub, recommended):** Put this folder in a GitHub repository. In Netlify, choose *Add new site → Import an existing project*, pick the repository, and deploy. Netlify installs the dependencies automatically.
- **Option B (command line):** Run `npm install`, then `npx netlify deploy --prod` from this folder.

### Step 4: Set the environment variables

In Netlify, go to **Site configuration → Environment variables** and add:

| Variable | Value |
|---|---|
| `APP_PIN` | The shared office PIN (for example, 6 digits). Choose your own. |
| `NETLIFY_DATABASE_URL` | Set automatically by Netlify Database. If not, paste the connection string here. |

After adding or changing variables, trigger a new deploy.

### Step 5: Add employees and test

1. Open the site and go to the **HR page** (`/hr.html`). Enter the PIN.
2. Add employee names.
3. Open the main page, select a name, and check in. Check out later and confirm the alert appears if you worked less than 8 hours.
4. On the HR page, download an Excel export and confirm the rows and alerts.

## Notes and limits

- **The site is public on the internet.** Anyone with the link can see the PIN screen, but they need the PIN to get in. Share the link only with staff, and change `APP_PIN` if it leaks.
- **Shared PIN, not individual logins.** Anyone with the PIN can select any name. This matches the agreed design. Individual PINs can be added later.
- **Monthly total** counts completed days only, up to today. The "÷ 26" value is the total hours divided by 26.
- **Timezone:** all times are stored in UTC and shown in Cairo time. Daylight-saving changes in Egypt are handled automatically.
- **Free plan limits** (Netlify credits and database limits) change over time. Check the pricing page and the usage meter each month.

## Running locally (optional)

Netlify CLI can run the site locally with the database variable set:

```bash
npm install
npx netlify dev
```
