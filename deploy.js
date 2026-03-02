#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Praxis Systems Discord Server-as-Code — V2 Premium Trading Server
// Idempotent • Fintech-Grade Permissions • Discord REST API v10
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

require("dotenv").config();
const fetch = require("node-fetch");

// ── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const BASE = "https://discord.com/api/v10";
const DRY_RUN = process.argv.includes("--dry-run");

if (!BOT_TOKEN || !GUILD_ID) {
    console.error("❌  Missing DISCORD_BOT_TOKEN or GUILD_ID in .env");
    process.exit(1);
}

// ── Permission Bitfields (BigInt) ────────────────────────────────────────────
const P = {
    VIEW_CHANNEL: 1024n,
    SEND_MESSAGES: 2048n,
    MANAGE_MESSAGES: 8192n,
    EMBED_LINKS: 16384n,
    ATTACH_FILES: 32768n,
    READ_MESSAGE_HISTORY: 65536n,
    ADD_REACTIONS: 64n,
    USE_APPLICATION_COMMANDS: 2147483648n,
    CREATE_PUBLIC_THREADS: 34359738368n,
    CREATE_PRIVATE_THREADS: 68719476736n,
    SEND_MESSAGES_IN_THREADS: 262144n,
    MANAGE_CHANNELS: 16n,
    MANAGE_ROLES: 268435456n,
    ADMINISTRATOR: 8n,
};

const BASIC_VIEW = (P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY).toString();
const BASIC_CHAT = (
    P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY |
    P.ADD_REACTIONS | P.USE_APPLICATION_COMMANDS | P.EMBED_LINKS | P.ATTACH_FILES
).toString();
const BASIC_CHAT_MANAGE = (
    P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY |
    P.ADD_REACTIONS | P.USE_APPLICATION_COMMANDS | P.EMBED_LINKS |
    P.ATTACH_FILES | P.MANAGE_MESSAGES
).toString();
const DENY_VIEW = P.VIEW_CHANNEL.toString();
const DENY_SEND = P.SEND_MESSAGES.toString();
const ZERO = "0";

// ── HTTP Helper ──────────────────────────────────────────────────────────────
const headers = {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
};

async function api(method, path, body = null) {
    const url = `${BASE}${path}`;
    const tag = `${method} ${path}`;

    if (DRY_RUN) {
        console.log(`[DRY-RUN] ${tag}`, body ? JSON.stringify(body).slice(0, 120) : "");
        if (method === "GET") return [];
        return { id: "dry-run-id", ...body };
    }

    for (let attempt = 0; attempt < 5; attempt++) {
        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);

        if (res.status === 429) {
            const json = await res.json().catch(() => ({}));
            const wait = (json.retry_after || 2) * 1000 + 500;
            console.warn(`⏳  Rate-limited on ${tag} — waiting ${wait}ms`);
            await sleep(wait);
            continue;
        }
        if (res.status === 204) return {};
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Discord ${res.status} on ${tag}: ${text}`);
        }
        return res.json();
    }
    throw new Error(`Rate-limit retries exhausted on ${tag}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const throttle = () => sleep(400);

// Permission overwrite builder
function ow(roleId, allow, deny) {
    return { id: roleId, type: 0, allow: allow || ZERO, deny: deny || ZERO };
}

// ── Server Guide Embed ───────────────────────────────────────────────────────
function buildServerGuideEmbed() {
    return {
        embeds: [{
            title: "📖 Server Guide — How to Navigate Praxis Systems",
            description: "Here's a quick overview of every section in this server so you know exactly where to go.",
            color: 0x2ecc71,
            fields: [
                {
                    name: "📋 START HERE",
                    value: "You're in it! This section has the welcome info, this guide, and official announcements from the team.",
                    inline: false,
                },
                {
                    name: "💬 COMMUNITY",
                    value: "**#general-chat** — Hang out, talk markets, connect with other traders\n**#wins-and-pnl** — Share your PnL screenshots and celebrate wins 🏆\n**#faq** — Common questions with pinned answers",
                    inline: false,
                },
                {
                    name: "📊 SCALP PRO / WICK HUNTER — SIGNAL DESKS",
                    value: "These are **private, members-only** sections for each algorithm. If you've subscribed to Scalp Pro or Wick Hunter, you'll see:\n• **#signals** — Real-time trade alerts\n• **#performance** — Track record & historical stats\n• **#daily-plan** — Pre-market outlook & key levels\n• **#discussion** — Discuss setups with fellow traders\n\n*Don't see these? You need to upgrade your plan.*",
                    inline: false,
                },
                {
                    name: "🎫 SUPPORT",
                    value: "**#create-ticket** — Open a support ticket for billing, access, or technical help\n**#platform-help** — General questions about using the platform",
                    inline: false,
                },
            ],
            footer: { text: "Questions? Open a ticket in #create-ticket" },
        }],
    };
}

// ── PnL Channel Starter Embed ────────────────────────────────────────────────
function buildPnlEmbed() {
    return {
        embeds: [{
            title: "🏆 Wins & PnL",
            description: "This is where we celebrate. Post your PnL screenshots, share your wins, and motivate the community.\n\n**How to post:**\n• Screenshot your broker PnL\n• Drop it here with a short caption\n• React to other members' wins 🔥\n\n*Let's keep the energy high.*",
            color: 0xf1c40f,
        }],
    };
}

// ── Ticket Channel Embed ─────────────────────────────────────────────────────
function buildTicketEmbed() {
    return {
        embeds: [{
            title: "🎫 Create a Support Ticket",
            description: "Need help? You're in the right place.\n\n**Common topics:**\n• Access issues — can't see your algo channels\n• Billing & subscription questions\n• Technical problems with the platform\n• General inquiries\n\n**How to get help:**\nType your question below and our support team will respond as soon as possible. Please include as much detail as you can.",
            color: 0x3498db,
            footer: { text: "Average response time: < 2 hours during business hours" },
        }],
    };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DEPLOYMENT
// ══════════════════════════════════════════════════════════════════════════════
(async () => {
    const report = {
        version: "2.0",
        roles: [],
        categories: [],
        channels: [],
        permissionBundles: { BASIC_VIEW, BASIC_CHAT, BASIC_CHAT_MANAGE },
        auditResults: [],
        messagesPosted: [],
        nextSteps: [],
    };

    console.log("\n🚀  Praxis Systems V2 Deployment Starting…");
    console.log(`    Guild: ${GUILD_ID}  |  Dry-run: ${DRY_RUN}\n`);

    // ─── STEP 0: Fetch Current State ──────────────────────────────────────────
    console.log("── STEP 0: Fetching current state ──");

    const guildRoles = await api("GET", `/guilds/${GUILD_ID}/roles`);
    const guildChannels = await api("GET", `/guilds/${GUILD_ID}/channels`);

    const roleByName = {};
    for (const r of guildRoles) roleByName[r.name] = r;

    const channelByName = {};
    const categoryByName = {};
    for (const c of guildChannels) {
        if (c.type === 4) categoryByName[c.name] = c;
        else channelByName[c.name] = c;
    }

    console.log(`   ${Object.keys(roleByName).length} roles, ${Object.keys(categoryByName).length} categories, ${Object.keys(channelByName).length} channels\n`);

    // ─── STEP 1: Lockdown @everyone ───────────────────────────────────────────
    console.log("── STEP 1: Locking down @everyone ──");
    await api("PATCH", `/guilds/${GUILD_ID}/roles/${GUILD_ID}`, { permissions: "0" });
    await throttle();
    console.log("   ✔ @everyone permissions = 0\n");

    // ─── STEP 2: Ensure Roles ─────────────────────────────────────────────────
    console.log("── STEP 2: Ensuring roles ──");

    const desiredRoles = [
        { name: "Admin", color: 0xe74c3c, hoist: true, permissions: "8" },
        { name: "Moderator", color: 0xe67e22, hoist: true, permissions: "0" },
        { name: "Support", color: 0x3498db, hoist: true, permissions: "0" },
        { name: "Scalp Pro", color: 0x2ecc71, hoist: false, permissions: "0" },
        { name: "Wick Hunter", color: 0x9b59b6, hoist: false, permissions: "0" },
        { name: "Free", color: 0x95a5a6, hoist: false, permissions: "0" },
    ];

    const roles = {};
    for (const desired of desiredRoles) {
        let role = roleByName[desired.name];
        if (role) {
            console.log(`   ✔ "${desired.name}" exists (${role.id})`);
            role = await api("PATCH", `/guilds/${GUILD_ID}/roles/${role.id}`, {
                color: desired.color, hoist: desired.hoist, permissions: desired.permissions,
            });
            await throttle();
        } else {
            console.log(`   ✚ Creating "${desired.name}"`);
            role = await api("POST", `/guilds/${GUILD_ID}/roles`, {
                name: desired.name, color: desired.color, hoist: desired.hoist, permissions: desired.permissions,
            });
            await throttle();
        }
        roles[desired.name] = role;
    }

    // Position roles (graceful fallback)
    const botUserId = BOT_TOKEN.split(".")[0];
    const botUserIdDecoded = Buffer.from(botUserId, 'base64').toString();
    let botHighestPos = 99;
    try {
        const botMember = await api("GET", `/guilds/${GUILD_ID}/members/${botUserIdDecoded}`);
        const botRoleIds = botMember.roles || [];
        botHighestPos = 0;
        for (const r of guildRoles) {
            if (botRoleIds.includes(r.id) && r.position > botHighestPos) botHighestPos = r.position;
        }
    } catch (e) { /* fallback to default */ }

    const startPos = Math.max(1, botHighestPos - desiredRoles.length);
    try {
        await api("PATCH", `/guilds/${GUILD_ID}/roles`,
            desiredRoles.map((d, i) => ({ id: roles[d.name].id, position: startPos + (desiredRoles.length - i - 1) }))
        );
        await throttle();
        console.log("   ✔ Roles positioned\n");
    } catch (e) {
        console.warn("   ⚠ Role ordering skipped — positions may vary\n");
    }

    for (const d of desiredRoles) report.roles.push({ name: d.name, id: roles[d.name].id });

    // Quick access
    const R = {};
    for (const name of Object.keys(roles)) R[name] = roles[name].id;
    R["@everyone"] = GUILD_ID;

    // ─── STEP 3: Clean Up Old V1 Categories ───────────────────────────────────
    console.log("── STEP 3: Cleaning up old V1 categories ──");

    const oldCategories = [
        "ENTRY & COMPLIANCE",
        "FREE LOBBY",
        "SCALP PRO — PRIVATE SIGNAL DESK",
        "WICK HUNTER — PRIVATE SIGNAL DESK",
        "SUPPORT CENTER",
        "STAFF LOGS",
    ];

    for (const oldName of oldCategories) {
        const cat = categoryByName[oldName];
        if (cat) {
            console.log(`   🗑 Deleting old category "${oldName}"`);
            // First delete all channels under this category
            for (const ch of guildChannels) {
                if (ch.parent_id === cat.id && ch.type !== 4) {
                    console.log(`      🗑 Deleting channel "${ch.name}"`);
                    await api("DELETE", `/channels/${ch.id}`);
                    await throttle();
                }
            }
            await api("DELETE", `/channels/${cat.id}`);
            await throttle();
        }
    }
    console.log();

    // ─── STEP 4: Create V2 Categories ─────────────────────────────────────────
    console.log("── STEP 4: Creating V2 categories ──");

    const v2Categories = [
        "📋 START HERE",
        "💬 COMMUNITY",
        "📊 SCALP PRO — SIGNAL DESK",
        "📊 WICK HUNTER — SIGNAL DESK",
        "🎫 SUPPORT",
        "🔒 STAFF ONLY",
    ];

    // Re-fetch after deletions
    const freshState = DRY_RUN ? [] : await api("GET", `/guilds/${GUILD_ID}/channels`);
    const freshCatByName = {};
    for (const c of freshState) {
        if (c.type === 4) freshCatByName[c.name] = c;
    }

    const categories = {};
    for (const name of v2Categories) {
        let cat = freshCatByName[name];
        if (cat) {
            console.log(`   ✔ "${name}" exists (${cat.id})`);
        } else {
            console.log(`   ✚ Creating "${name}"`);
            cat = await api("POST", `/guilds/${GUILD_ID}/channels`, { name, type: 4 });
            await throttle();
        }
        categories[name] = cat;
    }

    for (const name of v2Categories) report.categories.push({ name, id: categories[name].id });
    console.log();

    const C = {};
    for (const name of v2Categories) C[name] = categories[name].id;

    // ─── STEP 5: Category Permission Overwrites ───────────────────────────────
    console.log("── STEP 5: Applying category permissions ──");

    const catOverwrites = {
        "📋 START HERE": [
            ow(R["@everyone"], BASIC_VIEW, DENY_SEND),
            ow(R["Free"], BASIC_VIEW, ZERO),
            ow(R["Scalp Pro"], BASIC_VIEW, ZERO),
            ow(R["Wick Hunter"], BASIC_VIEW, ZERO),
        ],
        "💬 COMMUNITY": [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], BASIC_CHAT, ZERO),
            ow(R["Scalp Pro"], BASIC_CHAT, ZERO),
            ow(R["Wick Hunter"], BASIC_CHAT, ZERO),
        ],
        "📊 SCALP PRO — SIGNAL DESK": [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], ZERO, DENY_VIEW),
            ow(R["Scalp Pro"], BASIC_CHAT, ZERO),
            ow(R["Wick Hunter"], ZERO, DENY_VIEW),
        ],
        "📊 WICK HUNTER — SIGNAL DESK": [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], ZERO, DENY_VIEW),
            ow(R["Scalp Pro"], ZERO, DENY_VIEW),
            ow(R["Wick Hunter"], BASIC_CHAT, ZERO),
        ],
        "🎫 SUPPORT": [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], BASIC_CHAT, ZERO),
            ow(R["Scalp Pro"], BASIC_CHAT, ZERO),
            ow(R["Wick Hunter"], BASIC_CHAT, ZERO),
            ow(R["Support"], BASIC_CHAT_MANAGE, ZERO),
        ],
        "🔒 STAFF ONLY": [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], ZERO, DENY_VIEW),
            ow(R["Scalp Pro"], ZERO, DENY_VIEW),
            ow(R["Wick Hunter"], ZERO, DENY_VIEW),
            ow(R["Support"], ZERO, DENY_VIEW),
            ow(R["Moderator"], BASIC_VIEW, ZERO),
            ow(R["Admin"], BASIC_CHAT, ZERO),
        ],
    };

    for (const [catName, overwrites] of Object.entries(catOverwrites)) {
        console.log(`   ⛨ ${catName}`);
        await api("PATCH", `/channels/${C[catName]}`, { permission_overwrites: overwrites });
        await throttle();
    }
    console.log();

    // ─── STEP 6: Create Channels ──────────────────────────────────────────────
    console.log("── STEP 6: Creating channels ──");

    const v2Channels = [
        // START HERE
        { name: "welcome", parent: "📋 START HERE" },
        { name: "server-guide", parent: "📋 START HERE" },
        { name: "announcements", parent: "📋 START HERE" },
        // COMMUNITY
        { name: "general-chat", parent: "💬 COMMUNITY" },
        { name: "wins-and-pnl", parent: "💬 COMMUNITY" },
        { name: "faq", parent: "💬 COMMUNITY" },
        // ALGO 1
        { name: "scalp-pro-signals", parent: "📊 SCALP PRO — SIGNAL DESK" },
        { name: "scalp-pro-performance", parent: "📊 SCALP PRO — SIGNAL DESK" },
        { name: "scalp-pro-daily-plan", parent: "📊 SCALP PRO — SIGNAL DESK" },
        { name: "scalp-pro-discussion", parent: "📊 SCALP PRO — SIGNAL DESK" },
        // ALGO 2
        { name: "wick-hunter-signals", parent: "📊 WICK HUNTER — SIGNAL DESK" },
        { name: "wick-hunter-performance", parent: "📊 WICK HUNTER — SIGNAL DESK" },
        { name: "wick-hunter-daily-plan", parent: "📊 WICK HUNTER — SIGNAL DESK" },
        { name: "wick-hunter-discussion", parent: "📊 WICK HUNTER — SIGNAL DESK" },
        // SUPPORT
        { name: "create-ticket", parent: "🎫 SUPPORT" },
        { name: "platform-help", parent: "🎫 SUPPORT" },
        // STAFF ONLY
        { name: "security-logs", parent: "🔒 STAFF ONLY" },
        { name: "mod-chat", parent: "🔒 STAFF ONLY" },
    ];

    // Re-fetch channels after category creation
    const freshCh = DRY_RUN ? [] : await api("GET", `/guilds/${GUILD_ID}/channels`);
    const freshChByName = {};
    for (const ch of freshCh) {
        if (ch.type !== 4) freshChByName[ch.name] = ch;
    }

    const channels = {};
    for (const desired of v2Channels) {
        const parentId = C[desired.parent];
        let ch = freshChByName[desired.name];
        if (ch) {
            if (ch.parent_id !== parentId) {
                console.log(`   ↻ Moving "${desired.name}" → "${desired.parent}"`);
                ch = await api("PATCH", `/channels/${ch.id}`, { parent_id: parentId });
                await throttle();
            } else {
                console.log(`   ✔ "${desired.name}" (${ch.id})`);
            }
        } else {
            console.log(`   ✚ "${desired.name}" in "${desired.parent}"`);
            ch = await api("POST", `/guilds/${GUILD_ID}/channels`, {
                name: desired.name, type: 0, parent_id: parentId,
            });
            await throttle();
        }
        channels[desired.name] = ch;
    }

    for (const d of v2Channels) {
        report.channels.push({ name: d.name, id: channels[d.name].id, parent: d.parent });
    }
    console.log();

    // ─── STEP 7: Channel-Level Hardening ──────────────────────────────────────
    console.log("── STEP 7: Channel hardening ──");

    // welcome + server-guide: read-only
    for (const chName of ["welcome", "server-guide"]) {
        console.log(`   🔒 ${chName} → read-only`);
        await api("PATCH", `/channels/${channels[chName].id}`, {
            permission_overwrites: [
                ow(R["@everyone"], ZERO, DENY_VIEW),
                ow(R["Free"], BASIC_VIEW, DENY_SEND),
                ow(R["Scalp Pro"], BASIC_VIEW, DENY_SEND),
                ow(R["Wick Hunter"], BASIC_VIEW, DENY_SEND),
            ],
        });
        await throttle();
    }

    // announcements: Admin-only posting
    console.log("   🔒 announcements → Admin-only posting");
    await api("PATCH", `/channels/${channels["announcements"].id}`, {
        permission_overwrites: [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], BASIC_VIEW, DENY_SEND),
            ow(R["Scalp Pro"], BASIC_VIEW, DENY_SEND),
            ow(R["Wick Hunter"], BASIC_VIEW, DENY_SEND),
            ow(R["Admin"], BASIC_CHAT, ZERO),
        ],
    });
    await throttle();

    // create-ticket: Support gets manage
    console.log("   🔒 create-ticket → Support manages");
    await api("PATCH", `/channels/${channels["create-ticket"].id}`, {
        permission_overwrites: [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], BASIC_CHAT, ZERO),
            ow(R["Scalp Pro"], BASIC_CHAT, ZERO),
            ow(R["Wick Hunter"], BASIC_CHAT, ZERO),
            ow(R["Support"], BASIC_CHAT_MANAGE, ZERO),
        ],
    });
    await throttle();

    // platform-help: Support gets manage
    console.log("   🔒 platform-help → Support manages");
    await api("PATCH", `/channels/${channels["platform-help"].id}`, {
        permission_overwrites: [
            ow(R["@everyone"], ZERO, DENY_VIEW),
            ow(R["Free"], BASIC_CHAT, ZERO),
            ow(R["Scalp Pro"], BASIC_CHAT, ZERO),
            ow(R["Wick Hunter"], BASIC_CHAT, ZERO),
            ow(R["Support"], BASIC_CHAT_MANAGE, ZERO),
        ],
    });
    await throttle();
    console.log();

    // ─── STEP 8: Post Pre-Populated Messages ──────────────────────────────────
    console.log("── STEP 8: Posting pre-populated messages ──");

    const messagePosts = [
        { channel: "server-guide", embed: buildServerGuideEmbed, label: "Server guide" },
        { channel: "wins-and-pnl", embed: buildPnlEmbed, label: "PnL intro" },
        { channel: "create-ticket", embed: buildTicketEmbed, label: "Ticket guide" },
    ];

    for (const msg of messagePosts) {
        const chId = channels[msg.channel].id;
        // Check if bot already posted in this channel (idempotency)
        let alreadyPosted = false;
        if (!DRY_RUN) {
            try {
                const existing = await api("GET", `/channels/${chId}/messages?limit=5`);
                const botId = botUserIdDecoded;
                alreadyPosted = existing.some((m) => m.author?.id === botId && m.embeds?.length > 0);
            } catch (e) { /* proceed to post */ }
        }

        if (alreadyPosted) {
            console.log(`   ✔ ${msg.label} already posted in #${msg.channel}`);
        } else {
            console.log(`   📝 Posting ${msg.label} in #${msg.channel}`);
            await api("POST", `/channels/${chId}/messages`, msg.embed());
            await throttle();
        }
        report.messagesPosted.push({ channel: msg.channel, label: msg.label, posted: !alreadyPosted });
    }
    console.log();

    // ─── STEP 9: Post-Deploy Audit ────────────────────────────────────────────
    console.log("── STEP 9: Post-deploy audit ──");

    async function runAudit(fix = false) {
        const results = [];
        const allCh = DRY_RUN ? [] : await api("GET", `/guilds/${GUILD_ID}/channels`);

        const algo1Ch = allCh.filter((c) => c.parent_id === C["📊 SCALP PRO — SIGNAL DESK"]);
        const algo2Ch = allCh.filter((c) => c.parent_id === C["📊 WICK HUNTER — SIGNAL DESK"]);

        for (const ch of algo1Ch) {
            for (const check of [
                { label: "@everyone deny VIEW", roleId: R["@everyone"] },
                { label: "Free deny VIEW", roleId: R["Free"] },
                { label: "Wick Hunter deny VIEW", roleId: R["Wick Hunter"] },
            ]) {
                const owEntry = (ch.permission_overwrites || []).find((o) => o.id === check.roleId);
                const denyBits = BigInt(owEntry?.deny ?? "0");
                const pass = (denyBits & P.VIEW_CHANNEL) === P.VIEW_CHANNEL;
                const result = { channel: ch.name, check: check.label, pass, fixed: false };

                if (!pass && fix) {
                    console.warn(`   ⚠ FIXING: ${ch.name} — ${check.label}`);
                    const existing = ch.permission_overwrites || [];
                    const idx = existing.findIndex((o) => o.id === check.roleId);
                    const newDeny = (denyBits | P.VIEW_CHANNEL).toString();
                    if (idx >= 0) existing[idx].deny = newDeny;
                    else existing.push(ow(check.roleId, ZERO, newDeny));
                    await api("PATCH", `/channels/${ch.id}`, { permission_overwrites: existing });
                    await throttle();
                    result.fixed = true;
                }
                results.push(result);
            }
        }

        for (const ch of algo2Ch) {
            for (const check of [
                { label: "@everyone deny VIEW", roleId: R["@everyone"] },
                { label: "Free deny VIEW", roleId: R["Free"] },
                { label: "Scalp Pro deny VIEW", roleId: R["Scalp Pro"] },
            ]) {
                const owEntry = (ch.permission_overwrites || []).find((o) => o.id === check.roleId);
                const denyBits = BigInt(owEntry?.deny ?? "0");
                const pass = (denyBits & P.VIEW_CHANNEL) === P.VIEW_CHANNEL;
                const result = { channel: ch.name, check: check.label, pass, fixed: false };

                if (!pass && fix) {
                    console.warn(`   ⚠ FIXING: ${ch.name} — ${check.label}`);
                    const existing = ch.permission_overwrites || [];
                    const idx = existing.findIndex((o) => o.id === check.roleId);
                    const newDeny = (denyBits | P.VIEW_CHANNEL).toString();
                    if (idx >= 0) existing[idx].deny = newDeny;
                    else existing.push(ow(check.roleId, ZERO, newDeny));
                    await api("PATCH", `/channels/${ch.id}`, { permission_overwrites: existing });
                    await throttle();
                    result.fixed = true;
                }
                results.push(result);
            }
        }
        return results;
    }

    let auditResults = await runAudit(true);
    if (auditResults.some((r) => !r.pass && !r.fixed)) {
        console.log("   Re-running audit…");
        auditResults = await runAudit(false);
    }

    const passed = auditResults.filter((r) => r.pass || r.fixed).length;
    const failed = auditResults.filter((r) => !r.pass && !r.fixed).length;
    console.log(`   ✅ Audit: ${passed} passed, ${failed} failed\n`);
    report.auditResults = auditResults;

    // ─── STEP 10: Final Report ────────────────────────────────────────────────
    console.log("── STEP 10: Deployment Report ──\n");

    report.nextSteps = [
        "Map FanBasis purchases → assign 'Algo 1' or 'Algo 2' roles via Discord OAuth2",
        "On cancellation → remove the Algo role to revoke access instantly",
        "Configure a ticket bot (Ticket Tool / Modmail) in #create-ticket",
        "Set up audit logging webhooks → #security-logs",
        "Add a welcome bot to auto-assign 'Free' role on join",
    ];

    const reportJson = JSON.stringify(report, null, 2);
    console.log(reportJson);

    const fs = require("fs");
    const reportPath = `deployment-report-v2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(reportPath, reportJson, "utf8");
    console.log(`\n📄  Report saved to ${reportPath}`);
    console.log("🎉  Praxis Systems V2 deployment complete!\n");
})().catch((err) => {
    console.error("\n💥  Deployment failed:", err.message);
    process.exit(1);
});
