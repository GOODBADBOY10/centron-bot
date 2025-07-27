export const mainMenu = {
    parse_mode: "Markdown",
    reply_markup: {
        inline_keyboard: [
            [
                { text: "💰 Buy a Token", callback_data: "buy" },
                { text: "💸 Sell a Token", callback_data: "sell" }
            ],
            [
                { text: "💳 Wallets", callback_data: "wallets" },
            ],
            [
                { text: "👥 Referrals", callback_data: "referral" },
                { text: "📈 Positions", callback_data: "positions" }
            ],
            [
                { text: "⚙️ Config", callback_data: "config" }
            ]
        ]
    }
};