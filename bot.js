#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Praxis Premium Bot — Persistent Discord.js v14 Bot
// Verification Gate • Ticket System • Welcome Messages • Security Logging
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    AuditLogEvent,
    Events,
} = require("discord.js");

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!BOT_TOKEN || !GUILD_ID) {
    console.error("❌  Missing DISCORD_BOT_TOKEN or GUILD_ID in .env");
    process.exit(1);
}

// ── Bot Client ───────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ── Cached IDs (populated on ready) ──────────────────────────────────────────
let guild = null;
let freeRoleId = null;
let supportRoleId = null;
let adminRoleId = null;
let welcomeChannelId = null;
let generalChatId = null;
let createTicketId = null;
let securityLogsId = null;
let supportCategoryId = null;

// ── Color Palette ────────────────────────────────────────────────────────────
const COLORS = {
    orange: 0xf5a623,
    green: 0x2ecc71,
    red: 0xe74c3c,
    blue: 0x3498db,
    gold: 0xf1c40f,
    gray: 0x95a5a6,
};

// ══════════════════════════════════════════════════════════════════════════════
// BOT READY
// ══════════════════════════════════════════════════════════════════════════════
client.once(Events.ClientReady, async () => {
    console.log(`\n🤖  Praxis Bot online as ${client.user.tag}`);

    guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error("❌  Bot is not in the specified guild!");
        process.exit(1);
    }

    // Resolve IDs by name
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();

    freeRoleId = roles.find((r) => r.name === "Free")?.id;
    supportRoleId = roles.find((r) => r.name === "Support")?.id;
    adminRoleId = roles.find((r) => r.name === "Admin")?.id;

    channels.forEach((ch) => {
        if (!ch) return;
        switch (ch.name) {
            case "welcome": welcomeChannelId = ch.id; break;
            case "general-chat": generalChatId = ch.id; break;
            case "create-ticket": createTicketId = ch.id; break;
            case "security-logs": securityLogsId = ch.id; break;
        }
        if (ch.name === "SUPPORT" && ch.type === ChannelType.GuildCategory) {
            supportCategoryId = ch.id;
        }
    });

    console.log("   Resolved channel IDs:");
    console.log(`    welcome: ${welcomeChannelId}`);
    console.log(`    general-chat: ${generalChatId}`);
    console.log(`    create-ticket: ${createTicketId}`);
    console.log(`    security-logs: ${securityLogsId}`);
    console.log(`    SUPPORT category: ${supportCategoryId}`);
    console.log(`    Free role: ${freeRoleId}`);

    // ── Post verification embed in #welcome (if not already there) ──────────
    await postVerifyEmbed();

    // ── Post ticket embed in #create-ticket (if not already there) ──────────
    await postTicketEmbed();

    // ── Apply guild hardening ───────────────────────────────────────────────
    await hardenGuild();

    console.log("\n✅  Bot fully initialized and listening for events.\n");
});

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICATION GATE — Post embed with button in #welcome
// ══════════════════════════════════════════════════════════════════════════════
async function postVerifyEmbed() {
    if (!welcomeChannelId) return console.warn("⚠  #welcome channel not found");

    const channel = await guild.channels.fetch(welcomeChannelId);
    const messages = await channel.messages.fetch({ limit: 10 });
    const alreadyPosted = messages.some(
        (m) => m.author.id === client.user.id && m.components?.length > 0
    );

    if (alreadyPosted) {
        console.log("   ✔ Verify embed already in #welcome");
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle("Welcome to Praxis Systems")
        .setDescription(
            "Your gateway to professional algorithmic trading systems.\n\n" +
            "Please read the rules below and click **Verify** to access the server."
        )
        .setColor(COLORS.orange)
        .addFields(
            {
                name: "📜 Server Rules",
                value:
                    "• Be respectful to all members\n" +
                    "• Do not share signals or strategies outside this server\n" +
                    "• No financial advice — all content is educational\n" +
                    "• No spam, self-promotion, or solicitation\n" +
                    "• Follow Discord's Terms of Service",
            },
            {
                name: "🚀 Getting Started",
                value:
                    "1. Click **✅ Verify** below to accept the rules\n" +
                    "2. Read **#server-guide** for a full tour\n" +
                    "3. Chat in **#general-chat**\n" +
                    "4. Upgrade to Scalp Pro or Wick Hunter for live signals",
            },
            {
                name: "⚠️ Risk Disclaimer",
                value:
                    "Trading futures and other financial instruments involves substantial risk. " +
                    "Past performance is not indicative of future results. " +
                    "Nothing shared here constitutes financial advice.",
            }
        )
        .setFooter({ text: "Praxis Systems — Algorithmic Trading Systems" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("verify_accept")
            .setLabel("✅ I agree to the rules — Let me in")
            .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [row] });
    console.log("   📝 Verify embed posted in #welcome");
}

// ══════════════════════════════════════════════════════════════════════════════
// TICKET SYSTEM — Post embed with button in #create-ticket
// ══════════════════════════════════════════════════════════════════════════════
async function postTicketEmbed() {
    if (!createTicketId) return console.warn("⚠  #create-ticket channel not found");

    const channel = await guild.channels.fetch(createTicketId);
    const messages = await channel.messages.fetch({ limit: 10 });
    const alreadyPosted = messages.some(
        (m) => m.author.id === client.user.id && m.components?.length > 0
    );

    if (alreadyPosted) {
        console.log("   ✔ Ticket embed already in #create-ticket");
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle("🎫 Support Tickets")
        .setDescription(
            "Need help? Click the button below to open a private support ticket.\n\n" +
            "**Common topics:**\n" +
            "• Can't see your algo channels\n" +
            "• Billing & subscription questions\n" +
            "• Technical platform issues\n" +
            "• General inquiries\n\n" +
            "A support team member will respond as soon as possible."
        )
        .setColor(COLORS.blue)
        .setFooter({ text: "Average response time: < 2 hours during business hours" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_open")
            .setLabel("🎫 Open a Ticket")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [embed], components: [row] });
    console.log("   📝 Ticket embed posted in #create-ticket");
}

// ══════════════════════════════════════════════════════════════════════════════
// GUILD HARDENING — Set verification level, notifications, content filter
// ══════════════════════════════════════════════════════════════════════════════
async function hardenGuild() {
    try {
        await guild.edit({
            verificationLevel: 2,                // Medium — must have verified email
            defaultMessageNotifications: 1,      // Mentions only
            explicitContentFilter: 2,            // Scan all members
        });
        console.log("   ✔ Guild hardened: verification=Medium, notifications=mentions-only, content-filter=all");
    } catch (e) {
        console.warn(`   ⚠ Guild hardening failed: ${e.message}`);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// INTERACTION HANDLER — Button clicks
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    // ── Verify Button ────────────────────────────────────────────────────────
    if (interaction.customId === "verify_accept") {
        await handleVerify(interaction);
        return;
    }

    // ── Open Ticket ──────────────────────────────────────────────────────────
    if (interaction.customId === "ticket_open") {
        await handleTicketOpen(interaction);
        return;
    }

    // ── Close Ticket ─────────────────────────────────────────────────────────
    if (interaction.customId === "ticket_close") {
        await handleTicketClose(interaction);
        return;
    }
});

// ── Verify Handler ───────────────────────────────────────────────────────────
async function handleVerify(interaction) {
    const member = interaction.member;

    // Check if already verified
    if (member.roles.cache.has(freeRoleId)) {
        return interaction.reply({
            content: "You're already verified! ✅",
            ephemeral: true,
        });
    }

    try {
        await member.roles.add(freeRoleId);

        await interaction.reply({
            content:
                "✅ **Verified!** You now have access to the server.\n\n" +
                "👉 Start with **#server-guide** to learn your way around.\n" +
                "👉 Chat with the community in **#general-chat**.\n" +
                "👉 Upgrade to **Scalp Pro** or **Wick Hunter** for live signals.",
            ephemeral: true,
        });

        // Welcome message in #general-chat
        if (generalChatId) {
            const generalChat = await guild.channels.fetch(generalChatId);
            const welcomeEmbed = new EmbedBuilder()
                .setDescription(`Welcome **${member.user.username}**! 👋 Check out **#server-guide** and feel free to ask anything here.`)
                .setColor(COLORS.green);
            await generalChat.send({ embeds: [welcomeEmbed] });
        }

        // Security log
        await logSecurity(
            `✅ **Verified**: ${member.user.tag} (${member.user.id}) accepted rules and received Free role`,
            COLORS.green
        );
    } catch (e) {
        console.error("Verify error:", e);
        await interaction.reply({
            content: "Something went wrong. Please try again or contact an admin.",
            ephemeral: true,
        });
    }
}

// ── Ticket Open Handler ──────────────────────────────────────────────────────
async function handleTicketOpen(interaction) {
    const member = interaction.member;
    const ticketName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    // Check for existing open ticket
    const existing = guild.channels.cache.find(
        (ch) => ch.name === ticketName && ch.type === ChannelType.GuildText
    );

    if (existing) {
        return interaction.reply({
            content: `You already have an open ticket: <#${existing.id}>`,
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // Build permission overwrites for the ticket channel
        const overwrites = [
            {
                id: GUILD_ID, // @everyone
                deny: [PermissionFlagsBits.ViewChannel],
            },
            {
                id: member.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
        ];

        if (supportRoleId) {
            overwrites.push({
                id: supportRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            });
        }

        if (adminRoleId) {
            overwrites.push({
                id: adminRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.ManageChannels,
                ],
            });
        }

        const ticketChannel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: supportCategoryId || undefined,
            permissionOverwrites: overwrites,
        });

        // Post ticket intro embed
        const embed = new EmbedBuilder()
            .setTitle("🎫 Support Ticket")
            .setDescription(
                `Hello **${member.user.username}**, a support team member will be with you shortly.\n\n` +
                "**Please describe your issue below.** Include:\n" +
                "• What you need help with\n" +
                "• Any screenshots or error messages\n" +
                "• Your subscription type (if relevant)\n\n" +
                "*Click the button below when your issue is resolved.*"
            )
            .setColor(COLORS.blue)
            .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({
            content: `<@${member.user.id}>${supportRoleId ? ` <@&${supportRoleId}>` : ""}`,
            embeds: [embed],
            components: [closeRow],
        });

        await interaction.editReply({
            content: `Your ticket has been created: <#${ticketChannel.id}>`,
        });

        // Security log
        await logSecurity(
            `🎫 **Ticket opened**: ${member.user.tag} → #${ticketName}`,
            COLORS.blue
        );
    } catch (e) {
        console.error("Ticket open error:", e);
        await interaction.editReply({
            content: "Failed to create ticket. Please try again or contact an admin.",
        });
    }
}

// ── Ticket Close Handler ─────────────────────────────────────────────────────
async function handleTicketClose(interaction) {
    const channel = interaction.channel;

    if (!channel.name.startsWith("ticket-")) {
        return interaction.reply({
            content: "This doesn't appear to be a ticket channel.",
            ephemeral: true,
        });
    }

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setDescription("🔒 This ticket will be closed in **5 seconds**…")
                .setColor(COLORS.red),
        ],
    });

    // Log before deletion
    await logSecurity(
        `🔒 **Ticket closed**: #${channel.name} by ${interaction.user.tag}`,
        COLORS.red
    );

    setTimeout(async () => {
        try {
            await channel.delete("Ticket closed");
        } catch (e) {
            console.error("Ticket close error:", e);
        }
    }, 5000);
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMBER EVENTS — Join & Leave Logging
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== GUILD_ID) return;

    const accountAge = Math.floor(
        (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24)
    );
    const ageWarning = accountAge < 7 ? " ⚠️ **NEW ACCOUNT**" : "";

    await logSecurity(
        `📥 **Member joined**: ${member.user.tag} (${member.user.id})\n` +
        `Account age: ${accountAge} days${ageWarning}`,
        COLORS.green
    );
});

client.on(Events.GuildMemberRemove, async (member) => {
    if (member.guild.id !== GUILD_ID) return;

    const roles = member.roles.cache
        .filter((r) => r.name !== "@everyone")
        .map((r) => r.name)
        .join(", ") || "None";

    await logSecurity(
        `📤 **Member left**: ${member.user.tag} (${member.user.id})\nRoles: ${roles}`,
        COLORS.red
    );
});

// ── Role Change Logging ──────────────────────────────────────────────────────
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    // Added roles
    const added = newRoles.filter((r) => !oldRoles.has(r.id) && r.name !== "@everyone");
    for (const [, role] of added) {
        await logSecurity(
            `🟢 **Role added**: ${newMember.user.tag} → **${role.name}**`,
            COLORS.green
        );
    }

    // Removed roles
    const removed = oldRoles.filter((r) => !newRoles.has(r.id) && r.name !== "@everyone");
    for (const [, role] of removed) {
        await logSecurity(
            `🔴 **Role removed**: ${newMember.user.tag} ← **${role.name}**`,
            COLORS.red
        );
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY LOG HELPER
// ══════════════════════════════════════════════════════════════════════════════
async function logSecurity(message, color = COLORS.gray) {
    if (!securityLogsId) return;

    try {
        const channel = await guild.channels.fetch(securityLogsId);
        const embed = new EmbedBuilder()
            .setDescription(message)
            .setColor(color)
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error("Security log error:", e);
    }
}

// ── Login ────────────────────────────────────────────────────────────────────
client.login(BOT_TOKEN).catch((err) => {
    console.error("❌  Failed to login:", err.message);
    process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑  Bot shutting down…");
    client.destroy();
    process.exit(0);
});
