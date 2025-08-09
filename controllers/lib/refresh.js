import { fetchUser, saveUserStep, fetchUserStep } from "./db.js";
import { getBalance } from "./getBalance.js";
import { handleBuyTokenAddressFlow } from "./handleBuyTokenAddress.js";
import { handleSellTokenAddressFlow } from "./handleSellTokenAddress.js";
import { mainMenu } from "./mainMenu.js";

export const handleRefreshInfo = async (ctx) => {
    const userId = ctx.from.id;
    const step = await fetchUserStep(userId);

    if (
        !step ||
        !step.tokenAddress ||
        !Array.isArray(step.selectedWallets) ||
        step.selectedWallets.length === 0
    ) {
        await ctx.answerCbQuery("❌ Nothing to refresh.");
        return;
    }

    await ctx.answerCbQuery("🔄 Refreshing...");

    try {
        if (!step.tokenAddress.includes("::")) {
            await ctx.reply("❌ Stored token address is invalid. Please enter the token address again.");
            return;
        }

        const mode = step.mode || "buy";
        step.state = mode === "buy" ? "awaiting_buy_token_address" : "awaiting_sell_token_address";
        await saveUserStep(userId, step);

        if (mode === "buy") {
            await handleBuyTokenAddressFlow(ctx, step, step.tokenAddress);
        } else {
            await handleSellTokenAddressFlow(ctx, step, step.tokenAddress);
        }
    } catch (err) {
        await ctx.reply("❌ Failed to refresh token data. Please try again.");
    }
};

export async function handleBackToMenu(ctx) {
    const userId = ctx.from.id;
    const user = await fetchUser(userId);

    if (!user) {
        return ctx.reply("❌ Wallet not found. Use /start to generate one.");
    }

    const wallets = user.wallets || [];

    // Pre-fetch all balances concurrently
    const balances = await Promise.all(
        wallets.map(wallet =>
            wallet.walletAddress
                ? getBalance(wallet.walletAddress).then(balance => ({
                    balance: balance || { sui: "0", usd: "0" },
                    wallet
                }))
                : null
        )
    );

    let message = '';
    message += 'Welcome to *Centron Bot* 👋\n\n';
    message += "Trade seamlessly on Sui with low fees + high speeds. We support all DEXes, including memecoin launchpads.\n\n";

    balances.forEach((entry, i) => {
        if (!entry) return;
        const { balance, wallet } = entry;
        const address = wallet.walletAddress;
        const name = wallet.name?.trim();
        const label = `${name || `Sui Wallet ${i + 1}`}`;
        const escapedLabel = label.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
        const escapedAddress = address.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
        message += `*${escapedLabel}: ${balance.sui} SUI ($${balance.usd})*\n`;
        message += `\`${escapedAddress}\` \(tap to copy\)\n\n`;
    });

    message += 'To start trading, tap "Buy a Token" and paste the token address.';

    return ctx.reply(message, {
        parse_mode: "MarkdownV2",
        ...mainMenu,
    });
}