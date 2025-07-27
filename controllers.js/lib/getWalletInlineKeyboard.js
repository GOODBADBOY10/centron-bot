export function getWalletInlineKeyboard(wallet, index) {
    return {
        inline_keyboard: [
            [{ text: `✏️ ${wallet.name || "Wallet Name"}`, callback_data: `rename_wallet_${index}` }],
            [
                { text: "📤 Withdraw SUI", callback_data: `withdraw_sui_${index}` },
                { text: "📤 Withdraw Tokens", callback_data: `withdraw_tokens_${index}` }
            ],
            [
                { text: "❌ Delete", callback_data: `delete_wallet_${index}` },
                { text: "← Back", callback_data: "wallets" }
            ]
        ]
    };
}