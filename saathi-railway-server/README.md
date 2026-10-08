# SAATHI Railway Pilot Backend

Node.js + Express + Socket.IO backend for two-phone experiments. **Not production-ready.**

## Deploy to Railway
1. Create a GitHub repository and upload `package.json` and `server.js` (and this README).
2. In Railway: New Project > Deploy from GitHub Repo > choose your repository.
3. Railway automatically installs npm dependencies and runs `npm start`.
4. Under service Settings > Networking, generate a public domain (HTTPS).
5. Visit `https://YOUR-DOMAIN/health` and check `{"ok":true}`.
6. Configure both Android clients to connect to `https://YOUR-DOMAIN` using Socket.IO, not Firebase. The previous Android ZIP **does not yet connect to this backend**; its client integration must be updated.

## Socket.IO events
All client events with an acknowledgement callback return `{ok:true,...}` or `{ok:false,error:...}`.

- Saathi emits `provider:availability` with `{available:true,lat:18.65,lng:73.8}`. Keep sending `provider:location` with `{lat,lng}` as needed.
- Customer emits `job:create` with `{lat,lng,category:'Travel',description:'3 bags to Uber',from:'Flat 102',to:'Society gate',bags:'3'}`. Ack returns `jobId`.
- Customer emits `job:watch` with `{jobId}` on reconnect. Receives `search:radius` and `job:update`.
- Provider receives `job:offer` and emits `job:respond` with `{jobId,accept:true}` (or false).
- Assigned provider emits `job:status` with `{jobId,status:'arrived'|'in_progress'|'completed'}`.
- Customer can emit `job:expand` with `{jobId}` for testing; automatic expansion also occurs every ~12 seconds.

## Limitations / security
- No authentication or role authorization; any client with a job ID can watch it. Do not use real customer addresses or personal data.
- No database, no durable jobs, no multi-instance support. A server restart loses jobs and provider presence.
- No push notifications when Android app is closed; Socket.IO works only while client connected. FCM integration required.
- No payment, pricing engine, location permissions, or map tiles provided by this backend.
- GPS indoors is unreliable at 10 m; distance is approximate.
- Add authentication, rate limits, consent, safety checks, Postgres, monitoring, FCM, and secure CORS before public launch.
