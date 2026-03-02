// ──────────────────────────────────────────────────────────────────────────────
// Praxis Systems — PM2 Ecosystem
// Manages all three processes: bot, AI module, and webhook server
//
// Start all:    pm2 start ecosystem.config.js
// Save & boot:  pm2 save && pm2 startup
// Monitor:      pm2 monit
// Logs:         pm2 logs
// Restart all:  pm2 restart all
// ──────────────────────────────────────────────────────────────────────────────
module.exports = {
    apps: [
        {
            name: "praxis-bot",
            script: "bot.js",
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000,
            env: {
                NODE_ENV: "production",
            },
            log_file: "logs/bot.log",
            error_file: "logs/bot-error.log",
            merge_logs: true,
        },
        {
            name: "praxis-ai",
            script: "ai.js",
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000,
            env: {
                NODE_ENV: "production",
            },
            log_file: "logs/ai.log",
            error_file: "logs/ai-error.log",
            merge_logs: true,
        },
        {
            name: "praxis-webhooks",
            script: "webhooks.js",
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            env: {
                NODE_ENV: "production",
                PORT: "3000",
            },
            log_file: "logs/webhooks.log",
            error_file: "logs/webhooks-error.log",
            merge_logs: true,
        },
    ],
};
