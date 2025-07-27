import { getFallbackTokenDetails } from "../../utils/getTokenDetails.js";
import { getUserPositions } from "./db.js";
import { fetchUser, saveUserStep } from "./db.js"
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";


export async function showWalletsForPositions(ctx, userId) {
    try {
        const user = await fetchUser(userId);
        const allWallets = user.wallets || [];
        if (!allWallets.length) {
            return ctx.reply("❌ You haven't added any wallets yet.");
        }
        const walletButtons = [];
        const walletMap = {};
        allWallets.forEach((wallet, index) => {
            const address = wallet.address || wallet.walletAddress;
            const label = wallet.label || wallet.name || `${address.slice(0, 5)}...${address.slice(-4)}`;
            walletMap[`wallet_${index}`] = address;
            walletButtons.push({
                text: `💳 ${label}`,
                callback_data: `view_pos_idx_${index}`,
            });
        });
        const keyboard = [];
        for (let i = 0; i < walletButtons.length; i += 2) {
            keyboard.push(walletButtons.slice(i, i + 2));
        }
        keyboard.push([{ text: "← Main Menu", callback_data: "back_to_menu" }]);
        await saveUserStep(userId, {
            state: "awaiting_position_wallet",
            walletMap,
        });
        const messageText = `Choose a wallet to display active positions for:\n\n📘 <a href="https://example.com/help">How to Use?</a>`;

        await ctx.reply(messageText, {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup: { inline_keyboard: keyboard },
        });

        return true;
    } catch (e) {
        return ctx.reply("⚠️ Failed to load wallets.");
    }
}


export const getTokenPositions = async (userId, walletAddress, suiUsdPrice) => {
    const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

    const balances = await client.getAllBalances({ owner: walletAddress });

    const tokenPositions = await Promise.all(
        balances
            .filter(({ totalBalance }) => totalBalance !== "0")
            .map(async ({ coinType, totalBalance }) => {
                try {
                    const metadata = await client.getCoinMetadata({ coinType });
                    const readableAmount = Number(totalBalance) / 10 ** (metadata.decimals || 9);
                    // Try to get price and liquidity info
                    const fallbackDetails = await getFallbackTokenDetails(coinType, walletAddress);
                    const tokenInfo = fallbackDetails?.tokenInfo || {};

                    // Try to get average entry if available
                    const userPositions = await getUserPositions(userId, walletAddress);

                    let stored = null;
                    if (Array.isArray(userPositions)) {
                        stored = userPositions.find(p => p.tokenAddress.toLowerCase() === coinType.toLowerCase());
                    }
                    const avgEntrySUI = stored?.avgPriceSUI || 0;
                    const currentPriceSUI = tokenInfo.priceInSui || 0;
                    const avgEntryUsd = avgEntrySUI * suiUsdPrice;

                    // Position values
                    const currentValueSUI = readableAmount * currentPriceSUI;
                    const totalCostSUI = avgEntrySUI * readableAmount;

                    // Convert to USD
                    const currentValueUSD = currentValueSUI * suiUsdPrice;
                    const totalCostUSD = totalCostSUI * suiUsdPrice;

                    // PnL Calculations
                    const pnlUsd = currentValueUSD - totalCostUSD;
                    const pnlPercent = avgEntrySUI > 0 ? ((currentPriceSUI - avgEntrySUI) / avgEntrySUI) * 100 : 0;

                    const result = {
                        coinType,
                        name: metadata.name,
                        symbol: metadata.symbol,
                        decimals: metadata.decimals,
                        rawBalance: totalBalance,
                        readableBalance: readableAmount,
                        avgEntrySUI,
                        avgEntryUsd,
                        currentPriceSUI,
                        totalCostSUI,
                        totalCostUSD,
                        valueSUI: currentValueSUI,
                        valueUSD: currentValueUSD,
                        pnlUsd,
                        pnlPercent,
                        tokenInfo
                    };
                    return result;
                } catch (err) {
                    return null;
                }
            })
    );

    return tokenPositions.filter(Boolean);
};


export async function handlePositionsWalletList(ctx, userId) {
    const user = await fetchUser(userId);
    const wallets = user?.wallets || [];

    if (wallets.length === 0) {
        return ctx.reply("😕 You don’t have any wallets yet.");
    }

    const inline_keyboard = [];
    let index = 0;

    for (let i = 0; i < wallets.length; i += 2) {
        const row = [];

        for (let j = 0; j < 2 && i + j < wallets.length; j++) {
            const wallet = wallets[i + j];
            const shortAddress = wallet.walletAddress.slice(0, 6) + "..." + wallet.walletAddress.slice(-4);
            const name = wallet.name || shortAddress;

            row.push({
                text: `💳 ${name}`,
                callback_data: `view_pos_idx_${index}`
            });

            index++;
        }

        inline_keyboard.push(row);
    }

    const messageText = `Choose a wallet to display active positions for:\n\n📘 <a href="https://example.com/help">How to Use?</a>`;

    return ctx.editMessageText(messageText, {
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup: { inline_keyboard }
    });
}