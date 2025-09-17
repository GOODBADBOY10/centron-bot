import { getFallbackTokenDetails } from "../../utils/getTokenDetails.js";
import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { fetchUserStep, getUser, saveOrUpdatePosition, savePendingLimitOrder, saveUserStep } from "../lib/db.js";
import { showDcaConfirmation } from "../lib/dcaOrder.js";
import { decryptWallet } from "../lib/generateWallet.js";
import { formatNumber, removeUndefined } from "../lib/handleAction.js";
import { shortAddress } from "../lib/shortAddress.js";
import { toSmallestUnit } from "../lib/suiAmount.js";
import { formatMarketCapValue } from "../mcap/formatMarketCap.js";

export async function handleBuySellOrder(ctx, action) {
    const userId = ctx.from.id;
    const [baseAction, contextType] = action.split(":");
    const [mode, amountStr] = baseAction.split("_");
    const isLimitOrder = contextType === "limit";
    const isMarketOrder = contextType === "market";
    const isDcaOrder = contextType === "dca";

    const step = await fetchUserStep(userId);
    if (!step) return ctx.reply("❌ Session expired. Please start again.");

    const user = await getUser(userId);
    const wallets = user.wallets || [];

    if (!step.tokenAddress) {
        return ctx.reply("❌ No token selected. Please enter a token address first.");
    }

    const selectedWallets = (step.selectedWallets || []).map(k => step.walletMap?.[k]).filter(Boolean);
    if (selectedWallets.length === 0) {
        return ctx.reply("❌ No wallet selected.");
    }

    // Handle custom amount
    if (amountStr === "x") {
        let newState;

        if (mode === "buy") {
            newState = "awaiting_custom_buy_amount";
        } else {
            newState = "awaiting_custom_sell_amount";
        }

        let orderMode = "market";
        if (isLimitOrder) {
            orderMode = "limit";
        } else if (isDcaOrder) {
            orderMode = "dca";
        }

        await saveUserStep(userId, { ...step, state: newState, orderMode });

        if (mode === "buy") {
            return ctx.reply(
                `How much SUI would you like to use for the token purchase?\n\nPlease reply with the amount.`,
                { parse_mode: "Markdown", reply_markup: { force_reply: true } }
            );
        } else {
            return ctx.reply(
                `How much of your tokens would you like to sell?\n\nPlease reply with the percentage.`,
                { parse_mode: "Markdown", reply_markup: { force_reply: true } }
            );
        }
    }

    // Parse numeric amount
    const parsedAmount = parseFloat(amountStr);
    const suiAmount = !isNaN(parsedAmount) && parsedAmount > 0 ? toSmallestUnit(parsedAmount) : null;
    const suiPercentage = parseInt(amountStr, 10);
    const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
    const results = [];

    await ctx.reply(`⏳ Executing ${mode} order for ${selectedWallets.length} wallet(s)...`);

    for (const wallet of selectedWallets) {
        let phrase;
        const address = wallet.address || wallet.walletAddress;

        try {
            const encrypted = wallet.seedPhrase || wallet.privateKey;
            const decrypted = decryptWallet(encrypted, ENCRYPTION_SECRET);
            if (typeof decrypted === "string") phrase = decrypted;
            else if (decrypted && typeof decrypted === "object") phrase = decrypted.privateKey || decrypted.seedPhrase;
            if (!phrase) throw new Error("Missing decrypted phrase or key.");
        } catch (err) {
            results.push(`❌ ${wallet.name || shortAddress(address)}: Failed to decrypt wallet.`);
            continue;
        }

        try {
            if (isLimitOrder) {
                if (!step.limitTriggerValue) {
                    results.push(`❌ ${wallet.name || shortAddress(address)}: Missing trigger value.`);
                    continue;
                }
                await savePendingLimitOrder({
                    userId,
                    walletAddress: address,
                    tokenAddress: step.tokenAddress,
                    mode,
                    suiAmount,
                    suiPercentage,
                    triggerValue: step.limitTriggerValue,
                    slippage: mode === "buy" ? step.buySlippage : step.sellSlippage,
                });

                const formattedTrigger = formatMarketCapValue(step.limitTriggerValue);
                results.push(
                    `✅ Limit ${mode} order saved for <b>${amountStr}${mode === "buy" ? " SUI" : "%"}</b> and will trigger at <b>$${formattedTrigger}</b> market cap.`
                );
            } else if (isDcaOrder) {
                if (!step.dcaDuration || !step.dcaInterval) {
                    results.push(`❌ ${wallet.name || shortAddress(address)}: Missing DCA duration or interval.`);
                    continue;
                }
                const updatedStep = {
                    ...step,
                    pendingOrder: {
                        mode,
                        suiAmount,
                        suiPercentage,
                        type: "dca"
                    },
                    state: "awaiting_dca_confirmation",
                };
                await saveUserStep(userId, updatedStep);
                try {
                    return showDcaConfirmation(ctx, userId, updatedStep, { mode, suiAmount });
                    // return showDcaConfirmation(ctx, userId, step, { mode, suiAmount });
                } catch (err) {
                    console.error("❌ DCA failure:", err);
                    return ctx.reply("❌ Something went wrong with DCA order. Please try again.");
                }
            } else if (isMarketOrder) {
                const result = mode === "buy"
                    ? await buyTokenWithAftermath({ tokenAddress: step.tokenAddress, phrase, suiAmount, slippage: step.buySlippage })
                    : await sellTokenWithAftermath({ tokenAddress: step.tokenAddress, phrase, suiPercentage, slippage: step.sellSlippage });

                if (!result) throw new Error("No result returned");
                const decimals = result.decimals ?? 9;

                if (mode === "buy") {
                    const humanAmount = result.tokenAmountReceived / (10 ** decimals);
                    const tokenInfo = await getFallbackTokenDetails(result.tokenAddress, address);
                    await saveOrUpdatePosition(userId, address, removeUndefined({
                        tokenAddress: result.tokenAddress,
                        symbol: result.tokenSymbol,
                        amountBought: humanAmount,
                        amountInSUI: result.spentSUI,
                        decimals,
                        marketCap: tokenInfo?.tokenInfo?.marketCap ?? null,
                    }));
                }

                const txLink = `https://suiscan.xyz/mainnet/tx/${result.transactionDigest}`;
                const walletLink = `https://suiscan.xyz/mainnet/account/${address}`;
                const tokenAmountReadable = Number(result.tokenAmountSold) / (10 ** decimals);

                results.push(
                    `<a href="${walletLink}">${wallet.name || shortAddress(address)}</a> ✅ ${mode === "buy"
                        ? `Swapped ${formatNumber(result.spentSUI)} SUI ↔ ${formatNumber(result.tokenAmountReadable)} $${result.tokenSymbol}`
                        : `Swapped ${formatNumber(tokenAmountReadable)} $${result.tokenSymbol ?? "??"} ↔ ${formatNumber(result.actualSuiReceived ?? 0)} SUI`
                    }\n🔗 <a href="${txLink}">View Transaction Record on Explorer</a>`
                );
            }

        } catch (err) {
            const msg = typeof err?.message === "string" ? err.message : "Unknown error";
            results.push(`❌ ${wallet.name || shortAddress(address)}: ${msg}`);
        }
    }

    // Clear state after execution
    await saveUserStep(userId, { userId, state: null });

    await ctx.reply(results.join("\n\n"), { parse_mode: "HTML" });
    return ctx.answerCbQuery();
}