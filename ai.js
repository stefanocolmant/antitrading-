#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Praxis Systems — AI Bot Module (ai.js)
// Additive module — does NOT modify bot.js or deploy.js
//
// Features:
//   • AI Chatbot in #ask-praxis (GPT-4o, context-aware, per-user memory)
//   • Smart escalation → ticket button when human help is needed
//   • Slash commands: /tradingview, /mystatus
//   • TradingView username change tracker → alerts admin in #mod-chat
//   • Daily market briefing (8AM ET, weekdays)
//   • Inactive ticket auto-cleanup (48hr)
//   • Discord username change detector
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes,
} = require("discord.js");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

// ── Environment ───────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // app/client id

if (!BOT_TOKEN || !GUILD_ID) {
    console.error("❌  Missing DISCORD_BOT_TOKEN or GUILD_ID in .env");
    process.exit(1);
}

if (!OPENAI_KEY) {
    console.warn("⚠  OPENAI_API_KEY not set — AI chat will respond with a placeholder.");
}

// ── OpenAI Client ─────────────────────────────────────────────────────────────
const openai = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

// ── Data Paths ────────────────────────────────────────────────────────────────
const USERS_PATH = path.join(__dirname, "users.json");
const KB_PATH = path.join(__dirname, "knowledge-base.json");

function loadUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_PATH, "utf8")); }
    catch { return {}; }
}

function saveUsers(data) {
    fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), "utf8");
}

function loadKB() {
    try { return JSON.parse(fs.readFileSync(KB_PATH, "utf8")); }
    catch { return []; }
}

// ── Per-User Conversation Memory (last 20 messages for context) ───────────────
const conversationHistory = new Map(); // userId → [{role, content}]

function getHistory(userId) {
    if (!conversationHistory.has(userId)) conversationHistory.set(userId, []);
    return conversationHistory.get(userId);
}

function addToHistory(userId, role, content) {
    const history = getHistory(userId);
    history.push({ role, content });
    if (history.length > 20) history.splice(0, history.length - 20);
}

// ── Escalation Keyword Detection ──────────────────────────────────────────────
const ESCALATION_PHRASES = [
    "speak to someone", "real person", "human", "refund", "cancel my subscription",
    "cancel", "charge", "not working", "urgent", "can't access", "cannot access",
    "no access", "error", "broken", "wrong charge", "dispute", "chargeback",
];

function needsEscalation(text) {
    const lower = text.toLowerCase();
    return ESCALATION_PHRASES.some((p) => lower.includes(p));
}

// ── Build System Prompt ───────────────────────────────────────────────────────
function buildSystemPrompt(member, users) {
    const userData = users[member.id] || {};
    const subscription = userData.subscription || "Free (unverified or free tier)";
    const tvUsername = userData.tradingview_username || "not registered";

    const kb = loadKB();
    const kbText = kb.map((e) => `Q: ${e.q}\nA: ${e.a}`).join("\n\n");

    return `You are Praxis, the AI assistant for Praxis Systems — a professional algorithmic trading community on Discord.

You are talking to: ${member.user.username} (Discord ID: ${member.id})
Their subscription: ${subscription}
Their registered TradingView username: ${tvUsername}

Your personality: professional, concise, knowledgeable, and friendly. You sound like a senior quant who genuinely wants to help.

RULES:
- Never give specific financial advice or tell users to buy/sell specific assets
- Always add a brief risk disclaimer if discussing trading outcomes
- If the user asks about billing issues, refunds, or account problems you cannot verify, tell them to open a ticket
- If the user wants to speak to a human, respond with ESCALATE_TO_TICKET
- Keep responses under 300 words unless asked for a detailed explanation
- Use Discord markdown (bold, code blocks, bullet points) for formatting

KNOWLEDGE BASE:
${kbText}`;
}

// ── Discord Bot Client ────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ── Cached IDs ────────────────────────────────────────────────────────────────
let guild = null;
let aiChannelId = null;
let modChatId = null;
let generalChatId = null;
let securityLogsId = null;
let createTicketId = null;
let adminRoleId = null;
let supportRoleId = null;
let scalpProRoleId = null;
let wickHunterRoleId = null;
let communityChannelId = null;  // For role selector embed
let announcementsId = null;
let calendarChannelId = null; // #economic-calendar dedicated channel

// COLORS
const COLORS = {
    orange: 0xf5a623, green: 0x2ecc71, red: 0xe74c3c,
    blue: 0x3498db, purple: 0x9b59b6, gray: 0x95a5a6,
};

// ══════════════════════════════════════════════════════════════════════════════
// READY
// ══════════════════════════════════════════════════════════════════════════════
client.once(Events.ClientReady, async () => {
    console.log(`\n🧠  Praxis AI Bot online as ${client.user.tag}`);

    guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) { console.error("❌  Bot not in guild"); process.exit(1); }

    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();

    adminRoleId = roles.find((r) => r.name === "Admin")?.id;
    supportRoleId = roles.find((r) => r.name === "Support")?.id;
    scalpProRoleId = roles.find((r) => r.name === "Scalp Pro")?.id;
    wickHunterRoleId = roles.find((r) => r.name === "Wick Hunter")?.id;

    channels.forEach((ch) => {
        if (!ch) return;
        if (ch.name === "ask-praxis") aiChannelId = ch.id;
        if (ch.name === "mod-chat") modChatId = ch.id;
        if (ch.name === "general-chat") generalChatId = ch.id;
        if (ch.name === "security-logs") securityLogsId = ch.id;
        if (ch.name === "create-ticket") createTicketId = ch.id;
        if (ch.name === "announcements") announcementsId = ch.id;
        if (ch.name === "economic-calendar") calendarChannelId = ch.id;
        if (ch.type === ChannelType.GuildCategory && ch.name.includes("COMMUNITY")) communityChannelId = null; // handled below
    });
    // Find a text channel in COMMUNITY category for role selector
    channels.forEach((ch) => {
        if (ch && ch.name === "general-chat" && !communityChannelId) communityChannelId = ch.id;
    });

    // Ensure alert roles exist, create if not
    if (!roles.find((r) => r.name === "ScalpProAlerts")) {
        await guild.roles.create({ name: "ScalpProAlerts", color: "#2ecc71", reason: "Alert role for Scalp Pro signal pings" });
        console.log("   🆕 Created ScalpProAlerts role");
    }
    if (!roles.find((r) => r.name === "WickHunterAlerts")) {
        await guild.roles.create({ name: "WickHunterAlerts", color: "#e74c3c", reason: "Alert role for Wick Hunter signal pings" });
        console.log("   🆕 Created WickHunterAlerts role");
    }

    // Create #ask-praxis if it doesn't exist
    if (!aiChannelId) {
        aiChannelId = await createAiChannel(channels);
    }

    // Create #economic-calendar if it doesn't exist
    if (!calendarChannelId) {
        const startHereCat = channels.find(
            (c) => c && c.type === ChannelType.GuildCategory && c.name.includes("START HERE")
        );
        const freeRId = guild.roles.cache.find((r) => r.name === "Free")?.id;
        const spRId = guild.roles.cache.find((r) => r.name === "Scalp Pro")?.id;
        const whRId = guild.roles.cache.find((r) => r.name === "Wick Hunter")?.id;

        const overwrites = [{ id: GUILD_ID, deny: [PermissionFlagsBits.SendMessages] }];
        if (freeRId) overwrites.push({ id: freeRId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
        if (spRId) overwrites.push({ id: spRId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
        if (whRId) overwrites.push({ id: whRId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });

        const newCh = await guild.channels.create({
            name: "economic-calendar",
            type: ChannelType.GuildText,
            topic: "Daily high-impact economic events with plain-English explanations for NQ and Gold traders.",
            parent: startHereCat?.id || undefined,
            permissionOverwrites: overwrites,
        });
        calendarChannelId = newCh.id;
        console.log(`   🆕 Created #economic-calendar (${newCh.id})`);

        // Seed with intro message
        await newCh.send({
            embeds: [new EmbedBuilder()
                .setTitle("📅 Economic Calendar")
                .setDescription(
                    "This channel auto-posts **daily high-impact economic events** every weekday at **7:00 AM ET**.\n\n" +
                    "Only **USD high-impact** events are shown — the ones that actually move **NQ** and **Gold**.\n\n" +
                    "⚡ **Pro tip:** Reduce position size or stay flat during the 5 minutes before and after each release."
                )
                .setColor(COLORS.blue)
                .setFooter({ text: "Praxis Systems — Economic Calendar • Powered by Forex Factory" })],
        });
    }

    // Register slash commands
    await registerSlashCommands();

    // Post onboarding embed in #ask-praxis
    await postAiWelcomeEmbed();

    // Post role selector in #general-chat
    await postRoleSelectorEmbed();

    // Start scheduled tasks
    startScheduler();

    console.log("✅  AI Bot fully initialized.\n");
    console.log(`   #ask-praxis: ${aiChannelId}`);
    console.log(`   #mod-chat:   ${modChatId}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE #ask-praxis CHANNEL
// ══════════════════════════════════════════════════════════════════════════════
async function createAiChannel(channels) {
    // Find the START HERE category
    const startHere = channels.find(
        (ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.includes("START HERE")
    );

    const freeRoleId = guild.roles.cache.find((r) => r.name === "Free")?.id;
    const scalpRoleId = guild.roles.cache.find((r) => r.name === "Scalp Pro")?.id;
    const wickRoleId = guild.roles.cache.find((r) => r.name === "Wick Hunter")?.id;

    const overwrites = [
        { id: GUILD_ID, deny: [PermissionFlagsBits.ViewChannel] },
    ];
    if (freeRoleId) overwrites.push({ id: freeRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    if (scalpRoleId) overwrites.push({ id: scalpRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    if (wickRoleId) overwrites.push({ id: wickRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const ch = await guild.channels.create({
        name: "ask-praxis",
        type: ChannelType.GuildText,
        topic: "Chat with the Praxis AI assistant — ask anything about our systems, TradingView setup, or the markets.",
        parent: startHere?.id || undefined,
        permissionOverwrites: overwrites,
    });

    console.log(`   🆕 Created #ask-praxis (${ch.id})`);
    return ch.id;
}

// ══════════════════════════════════════════════════════════════════════════════
// POST AI WELCOME EMBED
// ══════════════════════════════════════════════════════════════════════════════
async function postAiWelcomeEmbed() {
    if (!aiChannelId) return;
    const ch = await guild.channels.fetch(aiChannelId);
    const msgs = await ch.messages.fetch({ limit: 10 });
    // Check if our embed with a button is already there
    if (msgs.some((m) => m.author.id === client.user.id && m.components?.length > 0)) return;
    // Delete any old bot messages first
    for (const [, m] of msgs) {
        if (m.author.id === client.user.id) await m.delete().catch(() => { });
    }

    const embed = new EmbedBuilder()
        .setTitle("🧠 Ask Praxis — Private AI Assistant")
        .setDescription(
            "Click the button below to start a **private** conversation with the Praxis AI assistant.\n\n" +
            "Your conversation is **only visible to you** — no one else can see it.\n\n" +
            "**I can help with:**\n" +
            "• Understanding Scalp Pro & Wick Hunter signals\n" +
            "• TradingView indicator setup & username management\n" +
            "• Market session times & trading basics\n" +
            "• Subscription & membership questions\n" +
            "• Anything else about Praxis Systems"
        )
        .setColor(COLORS.purple)
        .addFields({
            name: "⚡ Slash Commands (work anywhere)",
            value:
                "`/tradingview set username:yourname` — Register or update your TradingView username\n" +
                "`/mystatus` — See your subscription and registered details",
            inline: false,
        })
        .setFooter({ text: "Praxis Systems AI — Conversations are private" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("start_ai_chat")
            .setLabel("💬 Start Private AI Chat")
            .setStyle(ButtonStyle.Primary)
    );

    await ch.send({ embeds: [embed], components: [row] });
}

// Track which users have an active AI thread
const activeAiThreads = new Map(); // userId -> threadId

client.on(Events.InteractionCreate, async (interaction) => {
    // ── Start AI Chat Button ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === "start_ai_chat") {
        const userId = interaction.user.id;

        // If they already have an active thread, point them there
        if (activeAiThreads.has(userId)) {
            const existingId = activeAiThreads.get(userId);
            const existing = guild.channels.cache.get(existingId);
            if (existing) {
                return interaction.reply({
                    content: `You already have an active AI chat: <#${existingId}>`,
                    ephemeral: true,
                });
            }
            // Thread was deleted — remove stale reference
            activeAiThreads.delete(userId);
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const channel = await guild.channels.fetch(aiChannelId);

            // Create a private thread visible only to this user and admins
            const thread = await channel.threads.create({
                name: `praxis-ai-${interaction.user.username}`,
                type: ChannelType.PrivateThread,
                invitable: false, // only admins can add people
                autoArchiveDuration: 60, // archive after 1hr of inactivity
                reason: `Private AI chat for ${interaction.user.tag}`,
            });

            activeAiThreads.set(userId, thread.id);

            // Post welcome into the thread
            const users = loadUsers();
            const member = interaction.member;
            const userData = users[userId] || {};
            const sub = userData.subscription || detectSubscription(member);

            const welcomeEmbed = new EmbedBuilder()
                .setTitle("🧠 Praxis AI — Private Chat")
                .setDescription(
                    `Hey **${interaction.user.username}**! This is your private conversation with the Praxis AI.\n\n` +
                    "Type your question below and I'll reply instantly. Only you (and server admins) can see this thread.\n\n" +
                    `**Your plan:** ${sub} | **TradingView:** ${userData.tradingview_username ? `\`${userData.tradingview_username}\`` : "not registered"}\n\n` +
                    "Need a human? Just say **\"open a ticket\"** and I'll connect you."
                )
                .setColor(COLORS.purple)
                .setFooter({ text: "Praxis AI" });

            await thread.send({ content: `<@${userId}>`, embeds: [welcomeEmbed] });

            await interaction.editReply({
                content: `Your private AI chat is ready: <#${thread.id}>`,
            });
        } catch (err) {
            console.error("AI thread creation error:", err.message);
            await interaction.editReply({
                content: "Couldn't create your private chat thread. Please try again.",
            });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    await handleSlashCommand(interaction);
});

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER — AI Chat in private threads
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    // Only respond in private AI chat threads
    const isAiThread = [...activeAiThreads.values()].includes(message.channel.id)
        || (message.channel.isThread() && message.channel.name.startsWith("praxis-ai-"));
    if (!isAiThread) return;

    const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    const users = loadUsers();

    // Escalation check
    if (needsEscalation(message.content)) {
        await sendEscalationEmbed(message.channel, message.author);
        return;
    }

    await message.channel.sendTyping();

    const systemPrompt = buildSystemPrompt(member, users);
    addToHistory(message.author.id, "user", message.content);

    let reply = "";

    if (!openai) {
        reply = "⚠️ The AI is not configured yet (missing OPENAI_API_KEY).";
    } else {
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: systemPrompt },
                    ...getHistory(message.author.id),
                ],
                max_tokens: 500,
                temperature: 0.7,
            });

            reply = completion.choices[0]?.message?.content?.trim() || "I couldn't generate a response. Please try again.";

            if (reply.includes("ESCALATE_TO_TICKET")) {
                await sendEscalationEmbed(message.channel, message.author);
                return;
            }

            addToHistory(message.author.id, "assistant", reply);
        } catch (err) {
            console.error("OpenAI error:", err.message);
            reply = "I ran into an issue generating a response. Please try again in a moment.";
        }
    }

    const embed = new EmbedBuilder()
        .setDescription(reply)
        .setColor(COLORS.purple)
        .setFooter({ text: "Praxis AI" });

    await message.reply({ embeds: [embed] });
});

// ── Escalation Embed ──────────────────────────────────────────────────────────
async function sendEscalationEmbed(channel, user) {
    const embed = new EmbedBuilder()
        .setTitle("👋 Let's Connect You With Our Team")
        .setDescription(
            "It sounds like you'd benefit from speaking directly with a Praxis Systems team member.\n\n" +
            "Click the button below to open a **private support ticket** — our team will respond within 2 hours during business hours."
        )
        .setColor(COLORS.orange)
        .setFooter({ text: "Praxis Systems Support" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("🎫 Open a Support Ticket")
            .setStyle(ButtonStyle.Primary)
            .setURL(`https://discord.com/channels/${GUILD_ID}/${createTicketId}`)
    );

    await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [row] });
}

// ══════════════════════════════════════════════════════════════════════════════
// SLASH COMMANDS — Register & Handle
// ══════════════════════════════════════════════════════════════════════════════
async function registerSlashCommands() {
    if (!CLIENT_ID) {
        console.warn("⚠  DISCORD_CLIENT_ID not set — skipping slash command registration");
        return;
    }

    const commands = [
        new SlashCommandBuilder()
            .setName("tradingview")
            .setDescription("Manage your TradingView username for indicator access")
            .addSubcommand((sub) =>
                sub
                    .setName("set")
                    .setDescription("Set or update your TradingView username")
                    .addStringOption((opt) =>
                        opt.setName("username")
                            .setDescription("Your TradingView username")
                            .setRequired(true)
                    )
            )
            .addSubcommand((sub) =>
                sub.setName("view")
                    .setDescription("View your currently registered TradingView username")
            ),

        new SlashCommandBuilder()
            .setName("mystatus")
            .setDescription("View your Praxis Systems subscription and registered details"),
    ].map((cmd) => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log("   ✔ Slash commands registered");
    } catch (err) {
        console.error("   ✘ Slash command registration failed:", err.message);
    }
}

async function handleSlashCommand(interaction) {
    const users = loadUsers();
    const userId = interaction.user.id;

    // ── /mystatus ─────────────────────────────────────────────────────────────
    if (interaction.commandName === "mystatus") {
        const member = interaction.member;
        const userData = users[userId] || {};

        const roles = member.roles.cache
            .filter((r) => r.name !== "@everyone")
            .map((r) => r.name)
            .join(", ") || "None";

        const tvUser = userData.tradingview_username || "❌ Not registered";
        const sub = userData.subscription || "Free";
        const joined = userData.joined || "Unknown";

        const embed = new EmbedBuilder()
            .setTitle("📋 Your Praxis Systems Profile")
            .setColor(COLORS.blue)
            .addFields(
                { name: "Discord Username", value: interaction.user.username, inline: true },
                { name: "Subscription", value: sub, inline: true },
                { name: "TradingView Username", value: `\`${tvUser}\``, inline: false },
                { name: "Discord Roles", value: roles, inline: false },
                { name: "Member Since", value: joined, inline: true },
            )
            .setFooter({ text: "Use /tradingview set username: to update your TradingView username" });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // ── /tradingview ──────────────────────────────────────────────────────────
    if (interaction.commandName === "tradingview") {
        const sub = interaction.options.getSubcommand();

        if (sub === "view") {
            const userData = users[userId] || {};
            const tv = userData.tradingview_username || "Not registered";
            await interaction.reply({
                content: `Your registered TradingView username: \`${tv}\``,
                ephemeral: true,
            });
            return;
        }

        if (sub === "set") {
            const newUsername = interaction.options.getString("username").trim();
            const userData = users[userId] || {};
            const oldUsername = userData.tradingview_username || null;

            // Update the users database
            users[userId] = {
                ...userData,
                tradingview_username: newUsername,
                subscription: userData.subscription || detectSubscription(interaction.member),
                joined: userData.joined || new Date().toISOString().split("T")[0],
                discord_username: interaction.user.username,
            };
            saveUsers(users);

            // Notify admin team in #mod-chat
            if (modChatId) {
                const modChannel = await guild.channels.fetch(modChatId);
                const action = oldUsername
                    ? `**Change request** — remove \`${oldUsername}\`, add \`${newUsername}\``
                    : `**New access request** — add \`${newUsername}\``;

                const embed = new EmbedBuilder()
                    .setTitle("📈 TradingView Access Update Required")
                    .setDescription(
                        `<@${userId}> (${interaction.user.username}) has ${oldUsername ? "changed" : "registered"} their TradingView username.\n\n` +
                        `**Action required:** ${action}\n\n` +
                        `*Please update their indicator access on TradingView.*`
                    )
                    .setColor(COLORS.orange)
                    .addFields(
                        { name: "Discord User", value: `<@${userId}>`, inline: true },
                        { name: "Old TV Username", value: oldUsername || "None", inline: true },
                        { name: "New TV Username", value: `\`${newUsername}\``, inline: true },
                    )
                    .setTimestamp();

                await modChannel.send({ embeds: [embed] });
            }

            const confirmEmbed = new EmbedBuilder()
                .setDescription(
                    `✅ Your TradingView username has been set to \`${newUsername}\`.\n\n` +
                    `Our team has been notified and will update your indicator access shortly.${oldUsername ? `\n\n**Old username:** \`${oldUsername}\` will have its access removed.` : ""
                    }`
                )
                .setColor(COLORS.green);

            await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
            return;
        }
    }
}

function detectSubscription(member) {
    if (!member) return "Free";
    if (member.roles.cache.some((r) => r.name === "Scalp Pro")) return "Scalp Pro";
    if (member.roles.cache.some((r) => r.name === "Wick Hunter")) return "Wick Hunter";
    return "Free";
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMBER USERNAME CHANGE DETECTOR
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const oldName = oldMember.user.username;
    const newName = newMember.user.username;
    if (oldName === newName) return;

    const users = loadUsers();
    const userData = users[newMember.id];

    // Only alert if they have a TradingView username registered
    if (!userData?.tradingview_username) return;

    // Update stored discord username
    users[newMember.id].discord_username = newName;
    saveUsers(users);

    if (modChatId) {
        const modChannel = await guild.channels.fetch(modChatId);
        const embed = new EmbedBuilder()
            .setTitle("⚠️ Discord Username Changed")
            .setDescription(
                `<@${newMember.id}> changed their Discord username.\n\n` +
                `This user has a **registered TradingView username**: \`${userData.tradingview_username}\`\n\n` +
                `No action needed for TradingView unless they changed their TradingView username too. If unsure, ask them to run \`/tradingview set\` to confirm.`
            )
            .setColor(COLORS.orange)
            .addFields(
                { name: "Old Discord Username", value: oldName, inline: true },
                { name: "New Discord Username", value: newName, inline: true },
                { name: "TradingView Username", value: `\`${userData.tradingview_username}\``, inline: false },
            )
            .setTimestamp();

        await modChannel.send({ embeds: [embed] });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROLE ASSIGNMENT TRACKING — Auto-update users.json when roles change
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const users = loadUsers();
    const userId = newMember.id;
    const userData = users[userId] || {};

    const hadFree = oldMember.roles.cache.some((r) => r.name === "Free");
    const hasFree = newMember.roles.cache.some((r) => r.name === "Free");
    const hadScalpPro = oldMember.roles.cache.some((r) => r.name === "Scalp Pro");
    const hasScalpPro = newMember.roles.cache.some((r) => r.name === "Scalp Pro");
    const hadWickHunter = oldMember.roles.cache.some((r) => r.name === "Wick Hunter");
    const hasWickHunter = newMember.roles.cache.some((r) => r.name === "Wick Hunter");

    let changed = false;

    // Trigger onboarding DMs when Free role is first granted
    if (!hadFree && hasFree) {
        await startOnboarding(userId, newMember.user.username).catch(() => { });
    }

    if (!hadScalpPro && hasScalpPro) {
        userData.subscription = "Scalp Pro";
        changed = true;
    } else if (!hadWickHunter && hasWickHunter) {
        userData.subscription = "Wick Hunter";
        changed = true;
    } else if ((hadScalpPro && !hasScalpPro) || (hadWickHunter && !hasWickHunter)) {
        const stillHasScalp = newMember.roles.cache.some((r) => r.name === "Scalp Pro");
        const stillHasWick = newMember.roles.cache.some((r) => r.name === "Wick Hunter");
        userData.subscription = stillHasScalp ? "Scalp Pro" : stillHasWick ? "Wick Hunter" : "Free";
        changed = true;
    }

    if (changed) {
        userData.discord_username = newMember.user.username;
        userData.joined = userData.joined || new Date().toISOString().split("T")[0];
        users[userId] = userData;
        saveUsers(users);
        console.log(`   💾 Updated users.json for ${newMember.user.username}: ${userData.subscription}`);
    }
});


// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULERS
// ══════════════════════════════════════════════════════════════════════════════
function startScheduler() {
    // Daily market briefing — weekdays at 8:00 AM ET (13:00 UTC)
    cron.schedule("0 13 * * 1-5", async () => {
        if (!generalChatId) return;
        try {
            const ch = await guild.channels.fetch(generalChatId);
            const now = new Date().toLocaleDateString("en-US", {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
                timeZone: "America/New_York",
            });
            const embed = new EmbedBuilder()
                .setTitle("🌅 Daily Trading Briefing")
                .setDescription(
                    `Good morning traders! Today is **${now}**.\n\n` +
                    "The US futures market opens at **9:30 AM ET**. Pre-market begins at 6:00 AM ET.\n\n" +
                    "📊 Check your signal channel for today's daily plan:\n" +
                    "• Scalp Pro members → **#scalp-pro-daily-plan**\n" +
                    "• Wick Hunter members → **#wick-hunter-daily-plan**\n\n" +
                    "*Trade with discipline. Manage your risk.* 💪"
                )
                .setColor(COLORS.green)
                .setFooter({ text: "Praxis Systems — Automated Daily Briefing" })
                .setTimestamp();

            await ch.send({ embeds: [embed] });
        } catch (e) {
            console.error("Daily briefing error:", e.message);
        }
    }, { timezone: "America/New_York" });

    // Inactive ticket cleanup — check every hour
    cron.schedule("0 * * * *", async () => {
        if (!guild) return;
        try {
            const channels = await guild.channels.fetch();
            const now = Date.now();
            const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

            for (const [, ch] of channels) {
                if (!ch || ch.type !== ChannelType.GuildText) continue;
                if (!ch.name.startsWith("ticket-")) continue;

                const messages = await ch.messages.fetch({ limit: 1 });
                const lastMsg = messages.first();
                const lastActivity = lastMsg?.createdTimestamp || ch.createdTimestamp;

                if (now - lastActivity > FORTY_EIGHT_HOURS) {
                    console.log(`⏰ Auto-closing inactive ticket: #${ch.name}`);

                    const embed = new EmbedBuilder()
                        .setDescription("🔒 This ticket has been **auto-closed** due to 48 hours of inactivity.")
                        .setColor(COLORS.gray)
                        .setTimestamp();

                    await ch.send({ embeds: [embed] });
                    await new Promise((r) => setTimeout(r, 3000));
                    await ch.delete("Auto-closed: 48hr inactivity");
                }
            }
        } catch (e) {
            console.error("Ticket cleanup error:", e.message);
        }
    });

    // ── FEATURE 5: Economic Calendar — Every weekday at 7AM ET ───────────────
    cron.schedule("0 7 * * 1-5", async () => {
        try { await postEconomicCalendar(); }
        catch (e) { console.error("Economic calendar error:", e.message); }
    }, { timezone: "America/New_York" });

    // ── FEATURE 4: Onboarding check — every 30 minutes ────────────────────────
    cron.schedule("*/30 * * * *", async () => {
        try { await checkOnboardingQueue(); }
        catch (e) { console.error("Onboarding cron error:", e.message); }
    });

    console.log("   ⏰ Schedulers started (daily briefing + ticket cleanup + daily economic calendar)");
}

// ── Economic Calendar: Human-friendly descriptions for event types ────────────
const EVENT_DESCRIPTIONS = {
    "Non-Farm Employment Change": "Measures new jobs added to the US economy last month. A big beat = risk-on for equities/NQ. A miss = potential selloff.",
    "Unemployment Rate": "% of the workforce without jobs. Lower = stronger economy. Surprise moves can whipsaw NQ and Gold.",
    "CPI m/m": "Consumer Price Index month-over-month. The most important inflation number. Higher than expected = Fed stays hawkish = bearish for NQ, bullish for Gold short-term.",
    "Core CPI m/m": "CPI excluding food & energy. Fed watches this closely for rate decisions. Impacts NQ volatility significantly.",
    "PPI m/m": "Producer Price Index — upstream inflation indicator. Often signals where CPI is headed.",
    "FOMC Statement": "Federal Reserve rate decision + statement. One of the most volatile events of the year for futures markets. Expect wide spreads and fast moves.",
    "Fed Chair Press Conference": "Powell speaks after FOMC. Markets parse every word. High volatility on NQ and Gold expected.",
    "GDP q/q": "Quarterly economic growth. A miss can trigger risk-off across equities and safe-haven demand in Gold.",
    "Retail Sales m/m": "Measures consumer spending. Strong = bullish for stocks. Weak = potential downside for NQ.",
    "ISM Manufacturing PMI": "Industry health index. Below 50 = contraction. Key leading indicator for market direction.",
    "ISM Services PMI": "Services sector PMI. US economy is 70% services — this number matters.",
    "Initial Jobless Claims": "Weekly job loss claims. Rising claims = weakening economy = can spike Gold as safe haven.",
};

function getEventDescription(eventName) {
    for (const [key, val] of Object.entries(EVENT_DESCRIPTIONS)) {
        if (eventName.toLowerCase().includes(key.toLowerCase())) return val;
    }
    return "High-impact economic release — expect elevated volatility. Manage your risk carefully around this event.";
}

async function postEconomicCalendar() {
    if (!calendarChannelId) return;

    // Build today's date range in ET
    const todayET = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });

    // Fetch from Forex Factory's public JSON calendar
    let events = [];
    try {
        const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
            headers: { "User-Agent": "PraxisSystems/1.0" },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const all = await r.json();
        // Filter: USD only, HIGH impact only, TODAY
        events = all.filter((e) => {
            if (e.impact !== "High") return false;
            if (e.currency !== "USD" && e.currency !== "ALL") return false;
            if (!e.date) return false;
            const evtDay = new Date(e.date).toLocaleDateString("en-US", { timeZone: "America/New_York" });
            return evtDay === todayET;
        });
    } catch (fetchErr) {
        console.warn("Forex Factory fetch failed:", fetchErr.message);
        events = [];
    }

    const ch = await guild.channels.fetch(calendarChannelId);
    const dateStr = new Date().toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York",
    });

    if (events.length === 0) {
        // Post a quiet "all clear" for today so traders know it's clean
        const embed = new EmbedBuilder()
            .setTitle(`📅 Economic Calendar — ${dateStr}`)
            .setDescription(
                "✅ **No high-impact USD events scheduled for today.**\n\n" +
                "Markets may be calmer than usual. Good day for clean technical setups on NQ and Gold."
            )
            .setColor(COLORS.green)
            .setFooter({ text: "Praxis Systems — Economic Calendar • Source: Forex Factory" })
            .setTimestamp();
        await ch.send({ embeds: [embed] });
        console.log("   📅 Economic calendar: no high-impact events today");
        return;
    }

    const fields = events.map((e) => {
        const timeStr = e.date
            ? new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
            : "Time TBD";
        const forecast = e.forecast ? ` | Forecast: \`${e.forecast}\`` : "";
        const previous = e.previous ? ` | Previous: \`${e.previous}\`` : "";
        return {
            name: `🗓 ${e.title || e.country}${e.currency ? ` (${e.currency})` : ""}`,
            value: `**Time:** ${timeStr} ET${forecast}${previous}\n*${getEventDescription(e.title)}*`,
            inline: false,
        };
    });

    const embed = new EmbedBuilder()
        .setTitle(`⚡ ${events.length} High-Impact Event${events.length > 1 ? "s" : ""} Today — ${dateStr}`)
        .setDescription(
            "These USD releases **move NQ and Gold**. Plan your trades accordingly.\n\n" +
            "⚡ **Pro tip:** Reduce size or stay flat 5 min before and after each release."
        )
        .setColor(COLORS.orange)
        .addFields(fields)
        .setFooter({ text: "Praxis Systems — Economic Calendar • Source: Forex Factory" })
        .setTimestamp();

    await ch.send({ embeds: [embed] });
    console.log(`   📅 Economic calendar posted: ${events.length} high-impact events for today`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE 4 — ONBOARDING HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const ONBOARDING_PATH = path.join(__dirname, "onboarding.json");

function loadOnboarding() {
    try { return JSON.parse(fs.readFileSync(ONBOARDING_PATH, "utf8")); }
    catch { return {}; }
}

function saveOnboarding(data) {
    fs.writeFileSync(ONBOARDING_PATH, JSON.stringify(data, null, 2), "utf8");
}

const ONBOARDING_MESSAGES = [
    {
        day: 1,
        delayHours: 0,
        subject: "👋 Welcome to Praxis Systems!",
        body:
            "Hey! Welcome to **Praxis Systems** — glad to have you here. 🎉\n\n" +
            "Here's a quick map of the server so you can hit the ground running:\n\n" +
            "📖 **#server-guide** — full breakdown of all channels\n" +
            "📅 **#economic-calendar** — daily high-impact macro events (auto-posted every weekday at 7AM ET)\n" +
            "❓ **#faq** — answers to the most common questions\n" +
            "🛠 **#platform-help** — step-by-step TradingView setup\n" +
            "🤖 **#ask-praxis** — private AI assistant, available 24/7\n\n" +
            "Your first step: go to **#general-chat** and click the alert role button for the signals you're subscribed to — that way you'll get pinged every time a signal fires. 🔔\n\n" +
            "See you in the server!",
    },
    {
        day: 2,
        delayHours: 24,
        subject: "📊 How to Read a Praxis Signal",
        body:
            "Day 2 — let's make sure you know how to read the signals so you can act on them confidently.\n\n" +
            "**Every signal looks like this:**\n" +
            "```\n🟢 LONG — Gold (GC)\nEntry:  2,640.00\nSL:     2,618.00    ← your max loss — exit HERE if hit\nTP1:    2,660.00    ← first target, bank partial profit\nTP2:    2,680.00    ← second target\nTP3:    2,710.00    ← final target, max profit\n```\n\n" +
            "**Risk Rules:**\n" +
            "• Never risk more than **1-2% of your account** per trade\n" +
            "• If SL is hit → **exit immediately**. No averaging down.\n" +
            "• You don't have to take every signal — quality over quantity\n\n" +
            "⚠️ *These are algorithmic signals, not financial advice. Always manage your own risk.*",
    },
    {
        day: 3,
        delayHours: 48,
        subject: "🖥 Setting Up Your TradingView Indicator",
        body:
            "Day 3 — let's get you set up with the TradingView indicator so you can see signals live on your chart.\n\n" +
            "**Step 1 — Register your TradingView username**\n" +
            "Run this in any channel:\n" +
            "```\n/tradingview set username:YourTVUsername\n```\nAn admin will add you to the invite-only script access list.\n\n" +
            "**Step 2 — Add the indicator to your chart**\n" +
            "1. Open TradingView → your Gold or NQ chart\n" +
            "2. Click **Indicators** → **Invite-Only Scripts**\n" +
            "3. Find the Praxis indicator and click it\n\n" +
            "**Step 3 — Check #platform-help for screenshots**\n" +
            "Full step-by-step guide with visuals is in **#platform-help**.\n\n" +
            "You can also ask the AI assistant in **#ask-praxis** anything — it knows the full setup process. 🤖\n\n" +
            "Good luck and trade safe! 🎯",
    },
];

async function sendOnboardingDm(userId, msg) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(`**${msg.subject}**\n\n${msg.body}`);
    } catch (e) {
        console.warn(`   ⚠ Could not send onboarding DM to ${userId}:`, e.message);
    }
}

// Called when a user gets the "Free" role
async function startOnboarding(userId, username) {
    const onboarding = loadOnboarding();
    if (onboarding[userId]) return; // already enrolled

    onboarding[userId] = {
        username,
        enrolledAt: Date.now(),
        sentDays: [],
    };
    saveOnboarding(onboarding);

    // Send Day 1 immediately
    const day1 = ONBOARDING_MESSAGES.find((m) => m.day === 1);
    if (day1) {
        await sendOnboardingDm(userId, day1);
        onboarding[userId].sentDays.push(1);
        saveOnboarding(onboarding);
        console.log(`   📬 Started onboarding for ${username} — Day 1 sent`);
    }
}

// ── Onboarding Queue Processor ────────────────────────────────────────────────
async function checkOnboardingQueue() {
    const onboarding = loadOnboarding();
    let changed = false;

    for (const [userId, data] of Object.entries(onboarding)) {
        const hoursSinceEnroll = (Date.now() - data.enrolledAt) / 3_600_000;

        for (const msg of ONBOARDING_MESSAGES) {
            if (msg.day === 1) continue; // Day 1 sent immediately
            if (data.sentDays.includes(msg.day)) continue;
            if (hoursSinceEnroll >= msg.delayHours) {
                await sendOnboardingDm(userId, msg);
                data.sentDays.push(msg.day);
                changed = true;
                console.log(`   📬 Sent Day ${msg.day} onboarding DM to ${data.username}`);
            }
        }
    }

    if (changed) saveOnboarding(onboarding);
}


// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — SELF-ASSIGN ALERT ROLES (Role Selector)

// ══════════════════════════════════════════════════════════════════════════════
async function postRoleSelectorEmbed() {
    if (!generalChatId) return;
    const ch = await guild.channels.fetch(generalChatId);
    const msgs = await ch.messages.fetch({ limit: 20 });
    if (msgs.some((m) => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes("Signal Alerts"))) return;

    const embed = new EmbedBuilder()
        .setTitle("🔔 Signal Alert Roles")
        .setDescription(
            "Get pinged when a signal fires! Click a button below to toggle your alert roles.\n\n" +
            "**ScalpProAlerts** — get notified for every Scalp Pro signal\n" +
            "**WickHunterAlerts** — get notified for every Wick Hunter signal\n\n" +
            "*Click again to remove the role.*"
        )
        .setColor(COLORS.orange)
        .setFooter({ text: "Praxis Systems — You can toggle these anytime" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("toggle_scalp_alert").setLabel("📊 Scalp Pro Alerts").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("toggle_wick_alert").setLabel("📈 Wick Hunter Alerts").setStyle(ButtonStyle.Danger),
    );

    await ch.send({ embeds: [embed], components: [row] });
    console.log("   ✔ Role selector embed posted in #general-chat");
}

// Handle role toggle buttons — added to the unified InteractionCreate listener above (handleSlashCommand)
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    const userId = interaction.user.id;
    const member = interaction.member || await guild.members.fetch(userId);

    if (interaction.customId === "toggle_scalp_alert") {
        const freshRoles = await guild.roles.fetch();
        const role = freshRoles.find((r) => r.name === "ScalpProAlerts");
        if (!role) return interaction.reply({ content: "Role not found. Please contact an admin.", ephemeral: true });
        const has = member.roles.cache.has(role.id);
        if (has) {
            await member.roles.remove(role);
            await interaction.reply({ content: "✅ Removed **ScalpProAlerts** — you won't be pinged for Scalp Pro signals.", ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: "✅ Added **ScalpProAlerts** — you'll be pinged when a Scalp Pro signal fires!", ephemeral: true });
        }
        return;
    }

    if (interaction.customId === "toggle_wick_alert") {
        const freshRoles = await guild.roles.fetch();
        const role = freshRoles.find((r) => r.name === "WickHunterAlerts");
        if (!role) return interaction.reply({ content: "Role not found. Please contact an admin.", ephemeral: true });
        const has = member.roles.cache.has(role.id);
        if (has) {
            await member.roles.remove(role);
            await interaction.reply({ content: "✅ Removed **WickHunterAlerts** — you won't be pinged for Wick Hunter signals.", ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: "✅ Added **WickHunterAlerts** — you'll be pinged when a Wick Hunter signal fires!", ephemeral: true });
        }
        return;
    }
});

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(BOT_TOKEN).catch((err) => {
    console.error("❌  AI Bot login failed:", err.message);
    process.exit(1);
});

process.on("SIGINT", () => {
    console.log("\n🛑  AI Bot shutting down…");
    client.destroy();
    process.exit(0);
});
