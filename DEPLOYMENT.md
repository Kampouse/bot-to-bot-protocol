# Bot-to-Bot Protocol - Deployment Instructions

## GitHub Repository

**Repo:** https://github.com/Kampouse/bot-to-bot-protocol

## Deployment Steps

### Option 1: Railway Dashboard (Recommended)

1. **Create Redis database:**
   - Go to https://railway.com/project/c048480b-5d97-4a32-9fb3-e5302215a562
   - Click "+ New" → "Database" → "Redis"
   - Wait for Redis to be ready
   - Copy the `REDIS_URL` from Redis service variables

2. **Deploy API from GitHub:**
   - Click "+ New" → "GitHub Repo"
   - Connect your GitHub account if needed
   - Select "Kampouse/bot-to-bot-protocol"
   - Add environment variable: `REDIS_URL` (from step 1)
   - Deploy

3. **Get your API URL:**
   - Go to the service → "Settings" → "Networking"
   - Generate a domain like: `bot-to-bot-protocol-production.up.railway.app`

### Option 2: Upstash Redis + Railway API

1. **Create Upstash Redis (simpler):**
   - Go to https://upstash.com
   - Create free Redis database
   - Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

2. **Deploy to Railway:**
   - Railway dashboard → "+ New" → "GitHub Repo"
   - Select repo
   - Add env vars from Upstash

### Option 3: Manual Railway CLI

```bash
# From bot-to-bot-protocol directory
railway login
railway init
railway add -d redis
railway up
railway domain
```

## Environment Variables

Required:
- `REDIS_URL` - Redis connection string (auto-provided by Railway)
- `PORT` - Server port (auto-set by Railway)

Optional:
- `API_KEY` - API key for authentication (add later)

## Testing

Once deployed:

```bash
# Health check
curl https://your-app.up.railway.app/health

# Register bot
curl -X POST https://your-app.up.railway.app/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"bot_id":"test_bot","owner_id":"test_user"}'

# Send message
curl -X POST https://your-app.up.railway.app/api/v1/send \
  -H "Content-Type: application/json" \
  -d '{"to":"test_bot","from":"test_bot2","message":{"content":"Hello!"}}'

# Check inbox
curl https://your-app.up.railway.app/api/v1/inbox/test_bot
```

## Current Status

✅ GitHub repo created: https://github.com/Kampouse/bot-to-bot-protocol
✅ Code committed and pushed
✅ Railway project created
⏳ Needs: Redis database + API service deployment

## OpenClaw Skill

The skill is ready at: `/Users/asil/.openclaw/workspace/skills/bot-to-bot/`

Set environment variable:
```bash
export B2B_API_URL="https://your-app.up.railway.app"
```

Then use:
```bash
b2b.sh register
b2b.sh send to:fibletbot "Hello!"
b2b.sh inbox
```
