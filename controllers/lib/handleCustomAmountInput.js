import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { saveOrUpdatePosition, savePendingLimitOrder } from "./db.js";
import { updateUserStep, saveUserStep } from "./db.js";
import { decryptWallet } from "./generateWallet.js";
import { formatNumber, removeUndefined } from "./handleAction.js";
import { toSmallestUnit } from "./suiAmount.js";
import { shortAddress } from "./shortAddress.js";

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
                    const rawAmount = result.tokenAmountReceived;
                    const decimals = result.decimals ?? 9;
                    const tokenAmountReadable = Number(result.tokenAmountSold) / 1e9;

                    const humanAmount = rawAmount / (10 ** decimals);

                    await saveOrUpdatePosition(userId, address, removeUndefined({
                        tokenAddress: result.tokenAddress,
                        symbol: result.tokenSymbol,
                        amountBought: humanAmount,
                        amountInSUI: result.spentSUI,
                        decimals: decimals
                    }));
                }
                const txLink = `https://suiscan.xyz/mainnet/tx/${result.transactionDigest}`;
                const walletLink = `https://suiscan.xyz/mainnet/account/${address}`;
                const tokenAmountReadable = Number(result.tokenAmountSold) / 1e9;
                results.push(
                    `<a href="${walletLink}">${wallet.name || shortAddress(address)}</a> ✅ ${mode === "buy"
                        ? `Swapped ${formatNumber(result.spentSUI)} SUI ↔ ${formatNumber(result.tokenAmountReadable)} $${result.tokenSymbol}`
                        : `Swapped ${formatNumber(tokenAmountReadable)} $${result.tokenSymbol ?? "??"} ↔ ${formatNumber(result.actualSuiReceived ?? 0)} SUI`
                    }\n🔗 <a href="${txLink}">View Transaction Record on Explorer</a>`
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

        return ctx.reply(results.join("\n\n"), { parse_mode: "HTML" });
    }
    // Position-based Confirm Flow
    else if (handlerType === 'position') {
        const index = step.currentIndex;
        const mode = step.mode;
        const tokenAddress = step.tokenAddress;

        // Get user positions (if available)
        const positions = step.positions || [];
        const pos = positions[index];

        const tokenSymbol =
            pos?.symbol ||
            step.tokenInfo?.symbol ||
            (tokenAddress ? tokenAddress.split("::").pop() : "Unknown");


        const updatedStep = {
            ...step,
            state: null,
            currentIndex: null,
            mode: null,
            handlerType: null
        };
        await updateUserStep(userId, updatedStep);

        let amountLine = "";
        if (mode === "buy") {
            amountLine = `${amount} SUI\n`;
        } else {
            amountLine = `Percentage: ${amount}%\n`;
        }

        const confirmationMessage =
            `${mode === 'buy' ? '💰' : '💸'} Confirm ${mode.toUpperCase()}\n\n` +
            `Token: $${tokenSymbol}\n` +
            amountLine +
            `Action: ${mode.toUpperCase()}\n\n` +
            `Do you want to proceed?`;


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
                        text: `✅ Confirm`,
                        callback_data: confirmKey
                    },
                    {
                        text: "❌ Cancel",
                        callback_data: `view_pos_idx_${index}`
                    }
                ]
            ]
        };

        return ctx.reply(confirmationMessage, {
            parse_mode: "HTML",
            reply_markup: confirmationKeyboard
        });
    }
}