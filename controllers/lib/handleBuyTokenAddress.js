import { abbreviateNumber, formatBigNumber, formatTinyPrice, formatPriceAbbreviated, formatPricePrecise, getCoinBalance, getFallbackTokenDetails, withTimeout } from "../../utils/getTokenDetails.js";
import { getUser, saveUserStep } from "./db.js";
import { getBalance } from "./getBalance.js";
import { getWalletDisplayName } from "./getWalletName.js";
import { buildFullKeyboard } from "./handleLimitKeyboard.js";
import { shortAddress } from "./shortAddress.js";

export async function handleBuyTokenAddressFlow(ctx, step, tokenAddressFromStep = null) {
    const userId = ctx.from.id;
    const tokenAddress = tokenAddressFromStep ?? ctx.message?.text?.trim();

    // ❌ Invalid or expired session
    if (!step) return ctx.reply("❌ Session expired or not found. Please start again.");

    // ❌ Invalid token format
    if (!tokenAddress || !tokenAddress.includes("::"))
        return ctx.reply("❌ Invalid token address format. Please use a valid Move coin type (e.g., 0x...::module::TOKEN)");

    // 🔄 Loading message
    let loadingMsg;
    try {
        loadingMsg = await ctx.reply("🔍 Fetching token info...");
    } catch (err) {
        console.warn("⚠️ Failed to send loading message:", err.message);
    }

    let user, result;
    try {
        [user, result] = await Promise.all([
            getUser(userId),
            withTimeout(getFallbackTokenDetails(tokenAddress, step.selectedWallets?.[0]), 1800),
        ]);
    } catch (err) {
        console.error("❌ Token info fetch failed:", err);
        if (loadingMsg) {
            try {
                await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
            } catch (err) {
                console.warn("⚠️ Failed to delete loading message:", err.message);
            }
        }
        return ctx.reply("❌ Failed to fetch token data. Please check the address and try again.");
    }

    if (loadingMsg) {
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        } catch (err) {
            console.warn("⚠️ Failed to delete loading message:", err.message);
        }
    }

    if (!result || !result.tokenInfo) {
        return ctx.reply("❌ Token not found or lacks liquidity. Please try another token or start again.");
    }

    const { tokenInfo } = result;

    // ✅ Normalize wallets
    const rawWallets = user.wallets || [];
    const wallets = rawWallets.map((w) => {
        const address = w.walletAddress || w.address;
        return {
            ...w,
            address,
            name: w.name || shortAddress(address),
            seedPhrase: w.seedPhrase || w.phrase || null,
            buySlippage: w.buySlippage ?? 0.01,
            sellSlippage: w.sellSlippage ?? 0.01,
        };
    });

    const currentWallet = step.currentWallet?.toLowerCase();
    const selectedWallet =
        wallets.find((w) => w.address.toLowerCase() === currentWallet) || wallets[0];

    if (!selectedWallet) {
        return ctx.reply("❌ No wallet found. Please make sure you've created one.");
    }

    // ✅ Save selected wallet in step
    step.selectedWallets = [`w${wallets.findIndex(w => w.address.toLowerCase() === selectedWallet.address.toLowerCase())}`];
    step.walletMap = wallets.reduce((map, wallet, index) => {
        map[`w${index}`] = wallet;
        return map;
    }, {});
    step.seedPhrase = selectedWallet.seedPhrase;
    step.buySlippage = selectedWallet.buySlippage;
    step.sellSlippage = selectedWallet.sellSlippage;
    await saveUserStep(userId, step);

    // ✅ Fetch balances
    const balances = [];
    try {
        const [tokenBalance, suiBalance] = await Promise.all([
            withTimeout(getCoinBalance(selectedWallet.address, tokenInfo.address), 2500),
            withTimeout(getBalance(selectedWallet.address), 2500),
        ]);
        balances.push({ wallet: selectedWallet, suiBalance, tokenBalance });
    } catch (err) {
        await ctx.reply("⚠️ Failed to load balances. Defaulting to zero.");

        balances.push({
            wallet: selectedWallet,
            suiBalance: { sui: 0, usd: 0 },
            tokenBalance: { balance: 0, balanceUsd: 0 },
        });
    }

    // ✅ External links
    const explorerLink = `https://suiscan.xyz/mainnet/coin/${tokenInfo.address}/txs`;
    const chartLink = `https://dexscreener.com/sui/${tokenInfo.address}`;

    // ✅ Format display message
    let formattedMessage = `<b>${tokenInfo.symbol}</b> | <b>${tokenInfo.name}</b>\n\n`;
    formattedMessage += `<a href="${explorerLink}">Explorer</a> | <a href="${chartLink}">Chart</a>\n\n`;
    formattedMessage += `CA: <code>${tokenInfo.address}</code>\n\n`;
    formattedMessage += `Price: <b>${formatTinyPrice(tokenInfo.price || 0)}</b>\n`;
    formattedMessage += `Market Cap: <b>${formatBigNumber(Number(tokenInfo.marketCap))}</b>\n`;
    formattedMessage += `Liquidity: <b>${formatBigNumber(Number(tokenInfo.date))}</b>\n\n`;
    formattedMessage += `<b>Selected Wallets:</b>\n`;

    for (const { wallet, suiBalance, tokenBalance } of balances) {
        const tokenAmount = Number(tokenBalance.balance);
        const tokenValueUSD = Number(tokenBalance.balanceUsd);
        const formattedSui = suiBalance?.sui != null ? formatPricePrecise(suiBalance.sui) : "0.000";
        const formattedToken = abbreviateNumber(tokenAmount);
        const formattedUsdValue = formatPriceAbbreviated(tokenValueUSD);
        const formattedSuiValue = tokenInfo.priceInSui
            ? formatPricePrecise(tokenAmount * tokenInfo.priceInSui)
            : "";

        const walletName = getWalletDisplayName(wallet);
        const explorerWalletLink = `https://suiexplorer.com/address/${wallet.address}?network=mainnet`;
        formattedMessage += `<a href="${explorerWalletLink}">${walletName}</a> | ${formattedSui} SUI | ${formattedToken} $${tokenInfo.symbol}`;
        formattedMessage += formattedSuiValue
            ? ` (worth ${formattedSuiValue} SUI / ${formattedUsdValue})\n`
            : ` (worth ${formattedUsdValue})\n`;
    }

    // ✅ Save to step
    step.tokenInfo = tokenInfo;
    step.tokenAddress = tokenAddress;
    step.wallets = wallets;
    step.balances = balances;

    const keyboard = {
        inline_keyboard: buildFullKeyboard(step.selectedWallets, wallets, false, step.mode),
    };

    try {
        if (step.mainMessageId) {
            try {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    step.mainMessageId,
                    undefined,
                    formattedMessage,
                    {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                        reply_markup: keyboard,
                    }
                );
            } catch (err) {
                const sent = await ctx.reply(formattedMessage, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: keyboard,
                });
                step.mainMessageId = sent.message_id;
            }
        } else {
            const sent = await ctx.reply(formattedMessage, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: keyboard,
            });
            step.mainMessageId = sent.message_id;
        }
    } catch (err) {
        await ctx.reply("❌ Failed to show token info. Please try again.");
    }

    await saveUserStep(userId, step);
}