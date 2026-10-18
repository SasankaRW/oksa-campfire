# The Campfire: Kingswood Old Scouts' Association

A shared 3D virtual campfire. Everyone lays a log, which is visible to all as it lands. When the admin lights the fire, it catches and spreads across every log on every screen at the same moment.

## Pages

| URL | Who | What |
| --- | --- | --- |
| `/` | Everyone | Enter name and batch, take your log, drag it into the fire |
| `/admin` | Fire keeper | Passcode, light the fire (with countdown), stoke, let it burn low, put out, remove logs, rehearsal tools |
| `/stage` | Screen share in Google Meet | Clean view showing "Lay your log at <your-site>" |

Controls: scroll or pinch to zoom, or use the + / − buttons (keyboard + and −). Press **H** to hide all on-screen text (useful when screen sharing).
Quality: add `?q=low` or `?q=high` to the URL to force a quality level. Quality is detected automatically otherwise.

## Try it locally (no setup)

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without Supabase keys the app runs in **demo mode**, which syncs only between tabs of one browser. Open `/admin` (passcode `demo`), click "Add 20 test logs", then "Light the fire".

## Go live (about 10 minutes)

### 1. Supabase (free)
Step-by-step guide: **[docs/SUPABASE.md](docs/SUPABASE.md)**. Short version:

1. Create a project at https://supabase.com.
2. Go to **SQL Editor → New query**, paste `supabase/schema.sql` and run it.
3. Go to **Project Settings → API** and copy the Project URL, the `anon` key and the `service_role` key.

### 2. Vercel
1. Push this folder to a GitHub repo and import it at https://vercel.com/new. The framework is detected as Next.js.
2. Add these Environment Variables (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `ADMIN_PASSCODE` (pick a strong one)
3. Deploy.

### 3. Rehearse
Open `/admin`, add 100 test logs, shoot the fire arrow and check it on a laptop and a phone. Then click **Reset everything** before the event.

If you set up Supabase before this version, run `supabase/schema.sql` again. It's safe to re-run and adds the new functions.

## On the night
1. Share the link in the Meet chat. Each person opens it in their browser, enters a name and lays their log.
2. The host can screen-share `/stage` so people without the page open still see the fire.
3. When the moment comes, the admin clicks **Light the fire**. Everyone sees a 10-second countdown, then a torch comes in and the fire catches and spreads across the logs.
4. Use **Stoke the fire** for big moments, such as a speech or a song. Use **Let it burn low** for the closing.
5. After the fire is lit, everyone can download a **Keepsake** image with their name.

## Capacity (built for 400 people on free plans)
- **Live sync:** up to about 200 people get instant live updates (the Supabase free-plan limit). Everyone else is kept in sync automatically by a small check every 3 seconds. The fire is lit at a set time, so everyone still sees it catch together.
- **Load at 400 people:** about 130 tiny database requests a second during the event, and around 1.5 MB per visitor on Vercel (images are cached). Both are well within the free plans.
- **Vercel free plan:** only three small server functions (`/api/time`, `/api/logs`, `/api/admin`), each called about once per person. Everything else is static or talks to Supabase directly.
- **Optional extra safety:** upgrade Supabase to Pro for the event month (about $25) so up to 500 people get instant live updates. Nothing in the code needs to change.
- **Pile size:** each person lays one log, and the pile is designed for up to about 500 logs.

## Customise
- Wording, org name and year: `lib/config.js`
- Profanity list: `lib/profanity.js`
- Fire look: `components/Fire.jsx` (flames, sparks, smoke, light)
- Log look and burning: `components/logMaterial.js`
- Pile shape: `lib/layout.js`
- Sound (all synthesised, no audio files): `lib/audio.js`

## Images used
The night sky (a real Milky Way photo), the moon and the grass texture come from the three.js examples (MIT-licensed repo) and are stored in `public/textures`. To use your own sky, replace the six images in `public/textures/sky`.

## Performance
- No real-time shadows. Noise comes from one small 3D texture, and resolution drops automatically if the frame rate falls.
- Add `?q=low` to the link for older laptops and phones (this is automatic on most phones).
