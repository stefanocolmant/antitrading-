#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Praxis Systems — Signal Webhook Proxy (webhooks.js)
//
// Receives TradingView alerts → formats as premium Discord embeds
// Handles: Entry signals, Stop Loss hit, TP1 hit, TP2 hit, TP3 hit
//
// Run: node webhooks.js   (listens on port 3000 by default)
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());
app.use(express.text({ type: "*/*" }));

const SCALP_WEBHOOK = process.env.SCALP_PRO_WEBHOOK;
const WICK_WEBHOOK = process.env.WICK_HUNTER_WEBHOOK;
const PORT = process.env.WEBHOOK_PORT || 3000;

// ── Alert type detection ──────────────────────────────────────────────────────
function detectAlertType(data) {
    const txt = ((data.type || "") + " " + (data.message || "") + " " + (data.alert || "")).toLowerCase();
    if (txt.includes("tp3") || txt.includes("take profit 3") || txt.includes("target 3")) return "TP3";
    if (txt.includes("tp2") || txt.includes("take profit 2") || txt.includes("target 2")) return "TP2";
    if (txt.includes("tp1") || txt.includes("take profit 1") || txt.includes("target 1")) return "TP1";
    if (txt.includes("sl") || txt.includes("stop loss") || txt.includes("stop hit")) return "SL";
    if (txt.includes("long") || txt.includes("buy")) return "LONG";
    if (txt.includes("short") || txt.includes("sell")) return "SHORT";
    return "ALERT";
}

function normalizeSymbol(raw) {
    if (!raw) return "N/A";
    const s = raw.toUpperCase();
    if (s.includes("GOLD") || s.includes("GC") || s.includes("XAUUSD")) return "Gold (GC)";
    if (s.includes("NQ") || s.includes("NASDAQ")) return "NQ (NASDAQ Futures)";
    if (s.includes("ES") || s.includes("SP500") || s.includes("SPX")) return "ES (S&P 500 Futures)";
    return s;
}

// ── Build alert embed ─────────────────────────────────────────────────────────
function buildEmbed(raw, algo) {
    // Normalize body
    let data = raw;
    if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { data = { message: data }; }
    }

    const alertType = detectAlertType(data);
    const symbol = normalizeSymbol(data.ticker || data.symbol || data.instrument || "");
    const price = data.price || data.close || data.value || null;
    const entry = data.entry || data.price || null;
    const sl = data.sl || data.stop || data.stoploss || null;
    const tp1 = data.tp1 || data.target1 || data.t1 || null;
    const tp2 = data.tp2 || data.target2 || data.t2 || null;
    const tp3 = data.tp3 || data.target3 || data.t3 || null;
    const timeframe = data.timeframe || data.interval || null;
    const description = data.message || data.alert || null;

    // Determine color and emoji by alert type
    const typeConfig = {
        LONG: { color: 0x2ecc71, emoji: "🟢 LONG  — Entry Signal", pingRole: true },
        SHORT: { color: 0xe74c3c, emoji: "🔴 SHORT — Entry Signal", pingRole: true },
        TP1: { color: 0x27ae60, emoji: "✅ TP1 Hit — Partial Profit", pingRole: false },
        TP2: { color: 0x1e8449, emoji: "✅✅ TP2 Hit — Good Profit", pingRole: false },
        TP3: { color: 0x145a32, emoji: "🏆 TP3 Hit — Max Profit!", pingRole: false },
        SL: { color: 0x95a5a6, emoji: "⛔ Stop Loss Hit", pingRole: false },
        ALERT: { color: 0xf5a623, emoji: "⚡ Signal Alert", pingRole: true },
    };

    const cfg = typeConfig[alertType] || typeConfig.ALERT;
    const fields = [];

    // Price info
    if (price) fields.push({ name: "Price", value: `\`${price}\``, inline: true });
    if (entry && !price) fields.push({ name: "Entry", value: `\`${entry}\``, inline: true });
    if (timeframe) fields.push({ name: "Timeframe", value: `\`${timeframe}\``, inline: true });

    // Levels — show full setup on entry signals
    if (["LONG", "SHORT", "ALERT"].includes(alertType)) {
        if (sl) fields.push({ name: "🛑 Stop Loss", value: `\`${sl}\``, inline: true });
        if (tp1) fields.push({ name: "🎯 TP1", value: `\`${tp1}\``, inline: true });
        if (tp2) fields.push({ name: "🎯 TP2", value: `\`${tp2}\``, inline: true });
        if (tp3) fields.push({ name: "🏆 TP3", value: `\`${tp3}\``, inline: true });
    }

    fields.push({
        name: "⚠️ Risk Disclaimer",
        value: "Not financial advice. Always manage your risk. Past performance ≠ future results.",
        inline: false,
    });

    const embed = {
        title: `${cfg.emoji} — ${symbol}`,
        description: description || undefined,
        color: cfg.color,
        fields,
        footer: { text: `${algo} Signal Desk • Praxis Systems` },
        timestamp: new Date().toISOString(),
    };

    return { embeds: [embed] };
}

// ── Generic handler ───────────────────────────────────────────────────────────
async function handleAlert(req, res, webhookUrl, algo) {
    if (!webhookUrl) return res.status(500).json({ error: `Webhook URL not configured` });
    try {
        const payload = buildEmbed(req.body, algo);
        const r = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const alertType = detectAlertType(typeof req.body === "string" ? { message: req.body } : req.body);
        console.log(`[${new Date().toISOString()}] ${algo} ${alertType} alert → Discord HTTP ${r.status}`);
        res.json({ ok: true, alertType, httpStatus: r.status });
    } catch (e) {
        console.error(`${algo} webhook error:`, e.message);
        res.status(500).json({ error: e.message });
    }
}

// ── Scalp Pro ─────────────────────────────────────────────────────────────────
app.post("/alert/scalp-pro", (req, res) => handleAlert(req, res, SCALP_WEBHOOK, "Scalp Pro"));

// ── Wick Hunter ───────────────────────────────────────────────────────────────
app.post("/alert/wick-hunter", (req, res) => handleAlert(req, res, WICK_WEBHOOK, "Wick Hunter"));

// ── Health / setup reference ──────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        port: PORT,
        endpoints: {
            "Scalp Pro": `POST http://YOUR_IP:${PORT}/alert/scalp-pro`,
            "Wick Hunter": `POST http://YOUR_IP:${PORT}/alert/wick-hunter`,
        },
        tradingview_alert_format: {
            description: "In TradingView alert message box, paste this JSON:",
            example: {
                ticker: "{{ticker}}",
                price: "{{close}}",
                timeframe: "{{interval}}",
                message: "Scalp Pro Long signal on NQ",
                type: "long",
                sl: "21420",
                tp1: "21500",
                tp2: "21560",
                tp3: "21620",
            },
            notes: [
                "For SL hit alerts, set type: 'sl hit'",
                "For TP alerts, set type: 'tp1 hit' / 'tp2 hit' / 'tp3 hit'",
                "ticker and price will auto-fill from TradingView using {{ticker}} and {{close}}",
            ],
        },
    });
});

app.listen(PORT, () => {
    console.log(`\n🔗  Praxis Signal Webhook Proxy running on port ${PORT}`);
    console.log(`    Scalp Pro   → POST http://YOUR_IP:${PORT}/alert/scalp-pro`);
    console.log(`    Wick Hunter → POST http://YOUR_IP:${PORT}/alert/wick-hunter`);
    console.log(`    Setup guide → GET  http://YOUR_IP:${PORT}/health\n`);

    // ── Keep-alive self-ping (prevents Render free tier from sleeping) ──────────
    // Pings /health every 10 minutes so the instance stays warm for instant signal delivery
    const SELF_URL = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/health`
        : `http://localhost:${PORT}/health`;

    setInterval(async () => {
        try {
            await fetch(SELF_URL, { method: "GET" });
            console.log(`[${new Date().toISOString()}] 💓 Keep-alive ping sent`);
        } catch (e) {
            console.warn(`[${new Date().toISOString()}] Keep-alive ping failed:`, e.message);
        }
    }, 10 * 60 * 1000); // every 10 minutes
});
