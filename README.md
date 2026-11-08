# DrukCare

DrukCare is an Express, EJS, PostgreSQL, and Sequelize appointment-booking application for Bhutan. It includes a directory searchable across all 20 Dzongkhags, patient accounts, email verification and reset, facility/provider administration, recurring weekly availability, booking/rescheduling/cancellation, and scheduled reminders.

## Important directory and demo-data notice

The eight facility names included in the initial seed are taken from the supplied project brief and have **not** been independently verified against current official sources. Their addresses, phone numbers, coordinates, and websites are intentionally not invented or populated. Public facility records display a verification notice until an administrator confirms them.

The seeded DrukCare Demonstration Clinic, Demo Doctor, and generated appointment slots are entirely fictional and are visibly marked as demo data throughout the site. They exist only to exercise the booking flow. Do not travel to the demonstration facility or treat a demo appointment as a real medical visit.

All 20 Dzongkhags are available in search and registration. The seed does not invent hospital names for the remaining Dzongkhags; administrators can add facilities after verifying them.

## Requirements

- Node.js 20+
- PostgreSQL 13+
- An SMTP account for production verification, password reset, booking notifications, and reminders

## Local setup

1. Make sure PostgreSQL is running.
2. Copy `.env.example` to `.env` if one does not already exist. Set `DATABASE_URL` to your PostgreSQL username, password, host, port, and database. For example: `postgres://postgres:YOUR_POSTGRES_PASSWORD@127.0.0.1:5432/drukcare`. Replace the placeholder with your PostgreSQL password. Never share or commit your password.
3. Generate a session secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and place it in `.env`. Configure `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` if you want to use the administrator dashboard.
4. Install dependencies:

   ```sh
   npm install
   ```

5. Create the database, schema, and starter records:

   ```sh
   npm run setup
   ```

   The command asks for your PostgreSQL host, port, username, and database name, then securely prompts for your password without displaying it. It creates the database if needed, saves the connection URL in the Git-ignored `.env`, and runs migrations and demo seeds. If the PostgreSQL account cannot create databases, create `drukcare` in pgAdmin with a database superuser and run the command again.

6. Start the server:

   ```sh
   npm run dev
   ```

7. Open `http://localhost:3000`.

The server does not automatically synchronize application tables. Use the checked-in Sequelize migration. The session store table is initialized on server startup.

### Local email behavior

Without SMTP settings, development logs email bodies and one-time links to the server console. This is for local testing only. In production, the application fails email delivery explicitly when SMTP is not configured. Configure `BASE_URL` to the public HTTPS origin before sending email links.

### Testing reminder delivery

1. Configure a reachable SMTP account (or use development console logging).
2. Verify a patient account and create a future demo appointment slot from `/admin`.
3. For the 2-hour reminder, set the slot roughly 2 hours and 10 minutes ahead; for the 24-hour reminder, set it roughly 24 hours and 10 minutes ahead.
4. Start the worker with `npm run reminders`. It checks every 10 minutes, so allow one check interval for delivery.
5. Confirm the email and inspect the matching `appointment_reminders` record. Cancel the appointment and verify no later reminder is sent.

### Seeded administrator

`npm run db:seed` creates an administrator only when both `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set and that email does not already exist. Set a unique, strong password before seeding. No administrator password is hard-coded or supplied by the repository.

## Booking and reminders

- Patients must register and verify their email before booking.
- Search facilities by Dzongkhag, choose an assigned department/provider, and select an existing future slot.
- A database transaction locks and rechecks the slot before creating an appointment. A partial unique database index prevents two active appointments from using one slot while allowing a cancelled slot to be booked again.
- Patients can review and cancel their own appointments from the dashboard. Cancellation releases the slot.
- Admins can add facilities, departments, doctors, and individual appointment slots, and manage appointment status at `/admin`.
- Admins can configure weekly doctor availability; the system generates future slots in Bhutan time and allows open slots to be blocked or released. Provider schedules and live facility contacts must be verified before use.
- The reminder worker checks for due 24-hour and 2-hour reminders every 10 minutes in the `Asia/Thimphu` timezone. Run `npm run reminders` as a separate worker; for local testing, the web process can also start it with `ENABLE_REMINDERS=true`.
- Deploy exactly one continuously running reminder worker for a deployment. Reminder records have a unique appointment/kind constraint and a database claim state to avoid concurrent duplicate sends. SMTP errors are logged and retried while the appointment is in the reminder window.

## Environment variables

See `.env.example`. In production, set:

- `NODE_ENV=production`
- `BASE_URL` to the deployed HTTPS origin when not automatically provided by Render's `RENDER_EXTERNAL_URL`
- `SESSION_SECRET` to a high-entropy secret of at least 32 characters
- `DATABASE_URL` to the Render PostgreSQL internal URL
- `DATABASE_SSL=true` when required by the database provider
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the initial seed
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`

Never commit `.env` or production credentials.

## Render deployment

1. Sign in to Render and choose **New → Blueprint**.
2. Connect `07240058sherubtse-del/Drukcare` and select this project's `render.yaml`.
3. Review the Blueprint: the included starter configuration uses Render's free web service and free PostgreSQL tier for a demo. Render's free PostgreSQL database expires 30 days after creation; use a paid database for durable production data.
4. Set a unique administrator email and strong password, and configure SMTP values. Render supplies the public service URL and database URL automatically, and generates `SESSION_SECRET`.
5. Deploy and wait for `/healthz` to report `{"status":"ok"}`. Test registration, verification, booking, cancellation/rebooking, and email delivery before using real facility/provider data.

The free web service can sleep, so it is not a reliable 24/7 reminder worker. For production reminders, add one always-on Render Background Worker running `npm run reminders`, with the same database/SMTP environment, and choose a paid always-on plan. Do not enable the reminder scheduler in multiple processes.

## Tests

```sh
npm test
```

## Current limitations

- Official hospital/health-centre records, contacts, and map coordinates have not been independently sourced or verified. The initial directory is deliberately incomplete rather than fabricated.
- Only the clearly labelled demonstration facility has seeded departments, a demo provider, and example slots. A real appointment requires administrator-verified facility/provider information and configured schedules.
- Admin management supports creating, editing, and safely deleting facilities, departments, and providers; recurring weekly availability, generated future slots, individual slots, and blocking/unblocking open slots. Leave calendars and provider schedule exceptions remain to be implemented.
- The reminder process is in-process; production deployments need a persistent single worker and SMTP configuration. Use a transactional outbox/queue for stronger delivery guarantees at larger scale.
- No live deployment is claimed.

## Safety

DrukCare manages appointments; it does not diagnose, triage, or provide emergency medical advice. Confirm facility details and service availability directly with a healthcare provider.
