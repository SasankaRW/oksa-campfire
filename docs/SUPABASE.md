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
| `ADMIN_PASSCODE` | a passcode you choose for /admin |

Then go to **Deployments**, click the **⋯** menu on the latest deployment and choose **Redeploy**. Environment variables only take effect after a redeploy.

To test on your own computer instead, create a file called `.env.local` in the project folder with the same four lines (`NAME=value`) and restart `npm run dev`.

## 5. Test it
1. Open the site. The "Demo mode" tag at the top should be gone.
2. Open `/admin`, enter your passcode, and click **Add 20 test logs**.
3. Open the site on your phone as well. Both screens should show the same logs arriving.
4. Click **Shoot the fire arrow**. Both screens should light at the same moment.
5. When you're done, click **Reset everything**.

## On the event night
- The app is built for about 400 people on the free plan. Roughly the first 200 get instant live updates, and everyone else stays in sync through a quick check every 3 seconds. If you want instant updates for everyone, upgrade this project to **Pro** for that month (Organization → Billing), then downgrade afterwards.
- A free project **pauses after 7 days with no activity**. Open the site (or the Supabase dashboard) a day or two before the event so it's awake.
- If you ran an older `schema.sql` before, run the current one again. It's safe to re-run.
