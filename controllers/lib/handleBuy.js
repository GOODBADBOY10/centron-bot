import { getUser, saveUserStep } from "./db.js";

export async function handleBuy(ctx, userId) {
    const user = await getUser(userId);
    const wallets = user.wallets || [];
    const validWallets = wallets.filter(
        w => typeof w === 'object' && (w.address || w.walletAddress)
    );
    if (validWallets.length === 0) {
        return ctx.reply("❌ You need to import or generate a wallet first.");
    }
    const firstWallet = validWallets[0]?.address || validWallets[0]?.walletAddress;
    const sentMessage = await ctx.reply(
        "You're about to buy a token.\n\nPlease enter the token address below.",
        {
            parse_mode: "Markdown",
            reply_markup: {
                force_reply: true,
            },
        }
    );
    const step = {
        state: "awaiting_buy_token_address",
        currentWallet: firstWallet,
        currentFlow: "standard",
        selectedWallets: firstWallet ? [firstWallet] : [],
        wallets: validWallets.map(w => w.address || w.walletAddress),
        showAllWallets: false,
        buySlippage: Number.isFinite(validWallets[0]?.buySlippage) ? validWallets[0].buySlippage : 1,
        sellSlippage: validWallets[0]?.sellSlippage ?? 1,
        mode: "buy",
        mainMessageId: sentMessage.message_id,
    };
    await saveUserStep(userId, step);
}