import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { saveOrUpdatePosition, savePendingLimitOrder } from "./db.js";
import { updateUserStep, saveUserStep } from "./db.js";
import { decryptWallet } from "./generateWallet.js";
import { formatNumber } from "./handleAction.js";
import { toSmallestUnit } from "./suiAmount.js";

export async function handleCustomAmountInput(ctx, step, userId) {
    const amount = parseFloat(ctx.message.text);
    const address = step.currentWallet;
    const handlerType = step.handlerType || 'original';

    if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ Please enter a valid amount greater than 0.");
    }

    // Limit Order Handler
    if (step.orderMode === "limit") {
        const mode = step.state === 'awaiting_custom_buy_amount' ? 'buy' : 'sell';
        const tokenAddress = step.tokenAddress;
        const triggerValue = step.limitTriggerValue;

        if (!tokenAddress || !triggerValue) {
            return ctx.reply("❌ Missing token or trigger value for limit order.");
        }

        const suiAmount = mode === 'buy' ? toSmallestUnit(amount) : null;
        const suiPercentage = mode === 'sell' ? Math.floor(amount, 10) : null;

        await savePendingLimitOrder({
            userId,
            walletAddress: address,
            tokenAddress,
            mode,
            suiAmount,
            suiPercentage,
            triggerValue,
            slippage: mode === "buy" ? step.buySlippage : step.sellSlippage,
        });

        await saveUserStep(userId, {
            ...step,
            state: null,
            currentFlow: null,
            orderMode: null,
            limitTriggerValue: null,
        });

        return ctx.reply(`✅ Limit ${mode} order saved for ${amount}${mode === "buy" ? " SUI" : "%"}.\n📊 Will trigger at: <b>$${triggerValue}</b>`, {
            parse_mode: "HTML"
        });
    }

    // Market Order Handler
    if (handlerType === 'original') {
        const mode = step.state === 'awaiting_custom_buy_amount' ? 'buy' : 'sell';
        const tokenAddress = step.tokenAddress;
        const suiAmount = mode === 'buy' ? toSmallestUnit(amount) : null;
        const suiPercentage = mode === 'sell' ? Math.floor(amount, 10) : null;

        const selectedWallets = (step.selectedWallets || []).map(k => step.walletMap?.[k]).filter(Boolean);
        if (!selectedWallets.length) return ctx.reply("❌ No wallet selected.");

        await ctx.reply(`⏳ Executing ${mode} order for ${selectedWallets.length} wallet(s)...`);
        const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
        const results = [];

        for (const wallet of selectedWallets) {
            const address = wallet.address || wallet.walletAddress;
            let phrase;
            try {
                const encrypted = wallet.seedPhrase || wallet.privateKey;
                const decrypted = decryptWallet(encrypted, ENCRYPTION_SECRET);
                if (typeof decrypted === "string") {
                    phrase = decrypted;
                } else if (decrypted && typeof decrypted === "object") {
                    phrase = decrypted.privateKey || decrypted.seedPhrase;
                }
                if (!phrase) throw new Error("Missing decrypted phrase or key.");
            } catch (err) {
                results.push(`❌ ${wallet.name || shortAddress(wallet.address)}: Failed to decrypt wallet.`);
                continue;
            }
            try {
                const result = mode === 'buy'
                    ? await buyTokenWithAftermath({ tokenAddress, phrase, suiAmount, slippage: step.buySlippage })
                    : await sellTokenWithAftermath({ tokenAddress, phrase, suiPercentage, slippage: step.sellSlippage });

                if (!result) throw new Error("No result returned");

                if (mode === 'buy') {
                    await saveOrUpdatePosition(userId, address, {
                        tokenAddress: result.tokenAddress,
                        symbol: result.tokenSymbol,
                        amountBought: result.tokenAmountReceived,
                        amountInSUI: result.spentSUI,
                    });
                }
                const txLink = `https://suiscan.xyz/mainnet/tx/${result.txDigest}`;
                results.push(`
                    ${wallet.name || shortAddress(address)} ✅ ${mode === "buy"
                        ? `Swapped ${formatNumber(result.spentSUI)} SUI ↔ ${formatNumber(result.tokenAmountReadable)} $${result.tokenSymbol}`
                        : `Swapped ${formatNumber(result.tokenAmountReadable)} $${result.tokenSymbol} ↔ ${formatNumber(result.spentSUI)} SUI`}.\n\n` +
                    `🔗 <a href="${txLink}">View Transaction Record on Explorer</a>`
                );

            } catch (error) {
                results.push(`❌ ${wallet.name || shortAddress(address)}: ${error.message || error}`);
            }
        }
        await saveUserStep(userId, {
            ...step,
            state: null,
            currentFlow: null,
            orderMode: null,
            handlerType: null,
        });

        return ctx.reply(results.join("\n"), { parse_mode: "HTML" });
    }
    // Position-based Confirm Flow
    else if (handlerType === 'position') {
        const index = step.currentIndex;
        const mode = step.mode;
        const tokenAddress = step.tokenAddress;

        const updatedStep = {
            ...step,
            state: null,
            currentIndex: null,
            mode: null,
            handlerType: null
        };
        await updateUserStep(userId, updatedStep);

        const confirmationMessage = `${mode === 'buy' ? '💰' : '💸'} Confirm ${mode.toUpperCase()}\n\n` +
            `Token: ${tokenAddress.slice(0, 10)}...\n` +
            `Amount: ${amount} SUI\n` +
            `Action: ${mode}\n\n` +
            `Are you sure?`;
        const confirmKey = `confirm_${mode}_${index}`;
        // Save amount + token in step
        await saveUserStep(userId, {
            ...updatedStep,
            buySlippage: step.buySlippage ?? 1,
            sellSlippage: step.sellSlippage ?? 1,
            [confirmKey]: {
                amount,
                tokenAddress
            }
        });


        const confirmationKeyboard = {
            inline_keyboard: [
                [
                    {
                        text: `✅ Confirm ${mode.toUpperCase()}`,
                        callback_data: confirmKey
                    }
                ],
                [{ text: "❌ Cancel", callback_data: `view_pos_idx_${index}` }]
            ]
        };
        return ctx.reply(confirmationMessage, {
            parse_mode: "HTML",
            reply_markup: confirmationKeyboard
        });
    }
}