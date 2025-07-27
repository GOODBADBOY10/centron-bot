import { fetchUser } from "./db.js";
import { getBalance } from "./getBalance.js";

export async function handleWallets(ctx, userId) {
    const user = await fetchUser(userId);
    const userWallets = user?.wallets || [];

    if (userWallets.length === 0) {
        return ctx.reply("😕 No wallets found. Use the buttons below to add or connect one.", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "➕ New Wallet", callback_data: "new_wallet" }],
                    [{ text: "🔗 Connect Wallet", callback_data: "connect_wallet" }],
                    [{ text: "← Main Menu", callback_data: "back_to_menu" }]
                ]
            }
        });
    }
    const walletButtons = await Promise.all(
        userWallets.map(async (wallet, index) => {
            const address = wallet?.walletAddress;
            if (!address) return [];
            const balance = (await getBalance(address)) || "0";
            const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
            const name = wallet.name?.trim() || shortAddress;
            return [{ text: `💳 ${name} | ${balance.sui} SUI ($${balance.usd})`, callback_data: `wallet_${index}` }];
        })
    );
    try {
        await ctx.reply(`💳 Wallets [[${userWallets.length}]]`, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "➕ New Wallet", callback_data: "new_wallet" },
                        { text: "➕ X New Wallets", callback_data: "x_new_wallets" }
                    ],
                    [{ text: "🔗 Connect Wallet", callback_data: "connect_wallet" }],
                    ...walletButtons,
                    [{ text: "← Main Menu", callback_data: "back_to_menu" }]
                ]
            }
        });
    } catch (error) {
        if (error.description !== 'Bad Request: message is not modified') {
            throw error;
        }
    }
}