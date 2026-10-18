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
Open `/admin`, add 100 test logs, light the fire and check it on a laptop and a phone. Then click **Reset everything** before the event.

## On the night
1. Share the link in the Meet chat. Each person opens it in their browser, enters a name and lays their log.
2. The host can screen-share `/stage` so people without the page open still see the fire.
3. When the moment comes, the admin clicks **Light the fire**. Everyone sees a 10-second countdown, then a torch comes in and the fire catches and spreads across the logs.
4. Use **Stoke the fire** for big moments, such as a speech or a song. Use **Let it burn low** for the closing.
5. After the fire is lit, everyone can download a **Keepsake** image with their name.

## Capacity notes
- Each browser gets its own ID, so each person lays one log, and their name is attached to it.
- The Supabase free tier allows about 200 simultaneous realtime connections. If that limit is reached, pages switch automatically to checking for updates every 4 seconds, so everyone still sees the fire. For full realtime for everyone on the night, upgrade that one project to Supabase Pro for the month.
- The fire layout is designed for up to about 300 logs.

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
