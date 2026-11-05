# Supabase setup (about 10 minutes)

Supabase is the free online database that lets everyone share one fire. Until you add it, the site runs in demo mode, where only tabs in the same browser see the same fire.

## 1. Create the project
1. Go to https://supabase.com and click **Start your project**. Sign in with GitHub.
2. Click **New project**.
   - Name: `oksa-campfire`
   - Database password: click *Generate* and save it somewhere. You won't need it for this app.
   - Region: **Southeast Asia (Singapore)**, the closest to Sri Lanka.
3. Click **Create new project** and wait about 2 minutes while it sets up.

## 2. Create the tables
1. In the left sidebar, open **SQL Editor** and click **New query**.
2. Open `supabase/schema.sql` from this repo, copy everything in it and paste it into the editor.
3. Click **Run**. It should say "Success. No rows returned".
4. To check: open **Table Editor**. You should see two tables, `logs` and `fire_state`.
5. Then do the same with `supabase/migrations/2026-11-05-hardening.sql` (rate limits and a safer way to add logs). New projects get it from `schema.sql` already, but it's safe to run again.

## 3. Copy the keys
Open **Project Settings** (the gear icon), then:
- **Data API**: copy the **Project URL** (looks like `https://abcdxyz.supabase.co`).
- **API Keys**: copy these two keys:
  - the **anon / publishable** key (safe to use in the browser)
  - the **service_role / secret** key (server only: never share it or paste it into the website code)

Newer projects show "publishable" and "secret" keys, and the old "anon" and "service_role" keys are under a *Legacy API keys* tab. The app works with either pair.

## 4. Add the keys to Vercel
In Vercel, open your project, go to **Settings → Environment Variables**, and add:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role / secret key |
| `ADMIN_PASSCODE` | a long random passcode for /admin (16+ characters) |

Then go to **Deployments**, click the **⋯** menu on the latest deployment and choose **Redeploy**. Environment variables only take effect after a redeploy.

To test on your own computer instead, create a file called `.env.local` in the project folder with the same four lines (`NAME=value`) and restart `npm run dev`.

## 5. Test it
1. Open the site. The "Demo mode" tag at the top should be gone.
2. Open `/admin`, enter your passcode, and click **Add 20 test logs**.
3. Open the site on your phone as well. Both screens should show the same logs arriving.
4. Click **Shoot the fire arrow**. Both screens should light at the same moment.
5. When you're done, click **Reset everything**.

## On the event night
- The app is built for about 400 people on the free plan. Roughly the first 200 get instant live updates of the fire, and everyone else stays in sync through a quick check every 5 seconds. New logs reach everyone through that check (shared through Vercel's cache), not live. If you want instant updates for everyone, upgrade this project to **Pro** for that month (Organization → Billing), then downgrade afterwards.
- A free project **pauses after 7 days with no activity**. Open the site (or the Supabase dashboard) a day or two before the event so it's awake.
- If you ran an older `schema.sql` before, run the current one again. It's safe to re-run.

## Before the event (checklist)
- [ ] Run `supabase/migrations/2026-11-05-hardening.sql` in the SQL Editor (safe to re-run). Without it the site still works, but the log limit and passcode lockout are weaker.
- [ ] Wake the project: a free project **pauses after 7 days with no activity**. Open the site and the Supabase dashboard the day before and on the day.
- [ ] `ADMIN_PASSCODE` in Vercel is long and random (16+ characters), then redeploy. Five wrong tries from one address locks that address out for 10 minutes. If you lock yourself out, run `delete from public.rate_hits where key like 'admin:%';` in the SQL Editor (or, if you never ran the migration, redeploy), or just wait 10 minutes.
- [ ] **Never** press *Reset everything* or *Add test logs* while guests are connected. Do your tests well before guests arrive, then reset once.
- [ ] Check the shared cache works. Run this twice, a few seconds apart (the number is just a fixed moment in time, keep it as is):

  ```
  curl -s -D - -o /dev/null "https://<your-site>/api/since?s=1700000000000"
  ```

  The second answer should show `x-vercel-cache: HIT` (or `STALE`). If it always says `MISS`, every guest's check goes to the database: tell the developer.

Not done yet (ideas for later): a "soft reset" that hides logs instead of deleting them, so a mistaken reset could be undone.
