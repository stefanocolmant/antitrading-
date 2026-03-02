# Praxis Systems Discord Server-as-Code

Idempotent Discord server deployment + premium bot for the Praxis Systems algorithmic trading community.

## What It Does

**`deploy.js`** — One-shot server setup (safe to re-run):
- Creates 6 roles (Admin → Moderator → Support → Scalp Pro → Wick Hunter → Free)
- Creates 6 categories and 18 channels with clean hierarchy
- Applies fintech-grade permission isolation (Algo silos fully invisible)
- Runs a 24-check security audit and auto-fixes any issues
- Outputs a full JSON deployment report

**`bot.js`** — Persistent premium bot:
- ✅ **Verification gate** — Button in #welcome assigns Free role
- 🎫 **Ticket system** — Creates private support channels per user
- 👋 **Welcome messages** — Posts in #general-chat on verify
- 🔒 **Security logging** — Joins, leaves, role changes → #security-logs
- 🛡 **Guild hardening** — Email verification, mentions-only notifications

## Setup

```bash
# Install dependencies
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your DISCORD_BOT_TOKEN and GUILD_ID

# Deploy server architecture
npm run deploy

# Start the premium bot
npm run bot
```

## Requirements

- Node.js 18+
- Discord bot with Administrator permission
- Privileged intents enabled (Server Members + Message Content)

## Server Architecture

```
📋 START HERE         — welcome (verify gate), server-guide, announcements
💬 COMMUNITY          — general-chat, wins-and-pnl, faq
📊 SCALP PRO SIGNAL DESK — signals, performance, daily-plan, discussion
📊 WICK HUNTER SIGNAL DESK — signals, performance, daily-plan, discussion
🎫 SUPPORT            — create-ticket (bot), platform-help
🔒 STAFF ONLY         — security-logs, mod-chat
```

## License

Private — Praxis Systems © 2026
