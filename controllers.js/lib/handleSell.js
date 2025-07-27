import { getUser, saveUserStep } from "./db.js";

export async function handleSell(ctx, userId) {
    const user = await getUser(userId);
    const wallets = user.wallets || [];

    const validWallets = wallets.filter(
        w => typeof w === 'object' && (w.address || w.walletAddress)
    );

    const firstWallet = validWallets[0]?.address || validWallets[0]?.walletAddress;

    const sentMessage = await ctx.reply(
        "You're about to sell a token.\n\nPlease enter the token address below.",
        {
            parse_mode: "Markdown",
            reply_markup: {
                force_reply: true,
            },
        }
    );

    const step = {
        state: "awaiting_sell_token_address",
        currentWallet: firstWallet,
        selectedWallets: firstWallet ? [firstWallet] : [],
        wallets: validWallets.map(w => w.address || w.walletAddress),
        showAllWallets: false,
        buySlippage: validWallets[0]?.buySlippage ?? 1,
        sellSlippage: validWallets[0]?.sellSlippage ?? 1,
        mode: "sell",
        mainMessageId: sentMessage.message_id,
    };
    await saveUserStep(userId, step);
}
