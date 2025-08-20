import { buildActionRows, buildFooterRows, buildTokenInlineRows } from "../../utils/keyboard/keyboardBuilder.js";
import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { saveOrUpdatePosition, saveUserStep, fetchUser, getUser } from "./db.js";
import { decryptWallet } from "./generateWallet.js";
import { handleViewPosition } from "./handleViewPosition.js";
import { toSmallestUnit } from "./suiAmount.js";
import { shortAddress } from "./shortAddress.js";
import { formatNumber } from "./handleAction.js";



export function removeUndefined(obj) {
    if (Array.isArray(obj)) return obj.map(removeUndefined);
    if (obj !== null && typeof obj === "object") {
        return Object.entries(obj).reduce((acc, [key, val]) => {
            if (val !== undefined) acc[key] = removeUndefined(val);
            return acc;
        }, {});
    }
    return obj;
}


async function safeEditMessage(ctx, text, options = {}) {
    try {
        await ctx.editMessageText(text, options);
    } catch (err) {
        if (err?.description?.includes("message is not modified")) {
            // ignore harmless Telegram error
            return;
        }
        throw err;
    }
}

export const handleToggleBuySell = async (ctx, action) => {
    const userId = ctx.from.id.toString();
    const index = action.replace("toggle_buy_sell_idx_", "");

    try {
        const user = await fetchUser(userId);
        const prevStep = user?.step || {};
        const walletKey = `wallet_${index}`;
        const walletMap = prevStep.walletMap || {};
        const walletAddress = walletMap[walletKey];

        if (!walletAddress) return ctx.answerCbQuery("⚠️ Wallet address not found");

        const currentMode = prevStep[`tradeMode_${index}`] || "buy";
        const newMode = currentMode === "buy" ? "sell" : "buy";

        // Reuse cached token data if available
        const positions = prevStep[`cachedPositions_${index}`] || [];

        if (!positions.length) return ctx.answerCbQuery("⚠ No cached tokens found. Please reload /positions.");

        // Validate or fallback selected token
        let selectedToken = prevStep[`selectedToken_${index}`];
        if (!selectedToken || !positions.some(p => (p.tokenAddress || p.coinType) === selectedToken)) {
            selectedToken = positions[0]?.tokenAddress || positions[0]?.coinType;
        }

        // Build keyboard
        const tokenMap = {};
        positions.forEach((pos, i) => {
            if (pos.tokenAddress || pos.coinType) {
                tokenMap[`token_${i}`] = pos.tokenAddress || pos.coinType;
            }
        });

        const updatedStep = {
            ...prevStep,
            [`tradeMode_${index}`]: newMode,
            [`selectedToken_${index}`]: selectedToken,
            [`tokenMap_${index}`]: tokenMap,
        };

        // Answer immediately
        ctx.answerCbQuery(`Switched to ${newMode.toUpperCase()} mode`);

        // Build UI fast using cached data
        const tokenRows = buildTokenInlineRows(positions, selectedToken, index);
        const actionButtons = buildActionRows(newMode, index);
        const footer = buildFooterRows(index);
        const inline_keyboard = [...tokenRows, ...actionButtons, ...footer];
        // Only update keyboard for speed
        await ctx.editMessageReplyMarkup({ inline_keyboard });

        // Save step async in background
        saveUserStep(userId, removeUndefined(updatedStep)).catch(console.error);

    } catch (error) {
        console.error("❌ Error in handleToggleBuySell:", error);
        return ctx.answerCbQuery("❌ Error switching mode");
    }
};


export const handleSelectToken = async (ctx, action) => {
    const userId = ctx.from.id.toString();
    const match = action.match(/^select_token_idx_(\d+)_(token_\d+)$/);

    if (!match) return ctx.answerCbQuery("⚠ Invalid token selection");

    const index = match[1];
    const tokenKey = match[2];

    try {
        const user = await fetchUser(userId);
        const step = user?.step || {};
        const tokenMap = step?.[`tokenMap_${index}`] || {};
        const walletKey = `wallet_${index}`;
        const walletAddress = step.walletMap?.[walletKey];

        if (!walletAddress) return ctx.reply("⚠ Wallet address not found");

        const tokenAddress = tokenMap[tokenKey];
        if (!tokenAddress) return ctx.answerCbQuery("⚠ Token address not found");

        const currentMode = step[`tradeMode_${index}`] || "buy";
        const positions = step[`cachedPositions_${index}`] || [];

        if (!positions.length) return ctx.answerCbQuery("⚠ No cached tokens found. Reload with /positions");

        // Reorder positions by saved order
        const orderedTokenAddrs = step?.[`orderedTokens_${index}`] || [];
        const orderedPositions = orderedTokenAddrs
            .map(addr => positions.find(p => (p.tokenAddress || p.coinType) === addr))
            .filter(Boolean);

        // Rebuild token map
        const newTokenMap = {};
        orderedPositions.forEach((pos, i) => {
            newTokenMap[`token_${i}`] = pos.tokenAddress || pos.coinType;
        });
        const updatedStep = {
            ...step,
            [`selectedToken_${index}`]: tokenAddress,
            buySlippage: step.buySlippage ?? 1,
            sellSlippage: step.sellSlippage ?? 1,
        };
        saveUserStep(userId, removeUndefined(updatedStep)).catch(console.error);
        const tokenRows = buildTokenInlineRows(orderedPositions, tokenAddress, index);
        const actionButtons = buildActionRows(currentMode, index);
        const footer = buildFooterRows(index);
        const inline_keyboard = [...tokenRows, ...actionButtons, ...footer];

        await ctx.editMessageReplyMarkup({ inline_keyboard });
        return ctx.answerCbQuery("✅ Token selected");

    } catch (error) {
        console.error("❌ Error in handleSelectToken:", error);
        return ctx.answerCbQuery("❌ Failed to select token");
    }
};


export const handleBuySellAmount = async (ctx, action) => {
    const userId = ctx.from.id.toString();
    const isBuy = action.startsWith("buy_amount_");
    const actionType = isBuy ? "buy" : "sell";
    const match = action.match(/(buy|sell)_amount_(\d+|custom)_idx_(\d+)/);
    if (!match) {
        console.warn("⚠ Invalid action format:", action);
        return ctx.answerCbQuery("Invalid action");
    }

    const amount = match[2];
    const index = match[3];

    const user = await fetchUser(userId);
    const step = user?.step || {};

    const selectedTokenKey = `selectedToken_${index}`;
    const selectedTokenAddress = step[selectedTokenKey];

    if (!selectedTokenAddress) {
        console.warn("⚠ No selected token found in step data");
        return ctx.answerCbQuery("⚠ Please select a token first");
    }

    const tokenMap = step[`tokenMap_${index}`] || {};

    const tokenKey = Object.entries(tokenMap).find(([_, val]) => val === selectedTokenAddress)?.[0];

    if (!tokenKey) {
        console.warn("⚠ Token key not found for selected address");
        return ctx.answerCbQuery("⚠ Token key not found");
    }

    const walletKey = `wallet_${index}`;
    const walletAddress = step.walletMap?.[walletKey];

    if (!walletAddress) {
        console.warn("⚠ Wallet address not found in step data");
        return ctx.answerCbQuery("⚠ Wallet not found");
    }

    const positions = (step[`cachedPositions_${index}`] || []).map(p => ({
        ...p,
        tokenAddress: p.tokenAddress || p.coinType,
    }));

    const selectedToken = positions.find(
        pos =>
            pos.tokenAddress === selectedTokenAddress ||
            pos.coinType === selectedTokenAddress
    );

    // For sell, token must exist
    if (!selectedToken && !isBuy) {
        console.warn("⚠ Token not found in wallet positions during sell");
        return ctx.answerCbQuery("⚠ Selected token not found in wallet");
    }

    // Handle custom input
    if (amount === "custom") {
        let newState;
        let prompt;

        if (actionType === "buy") {
            newState = "awaiting_custom_buy_amount";
            prompt = "✍️ Enter the amount of SUI you want to use to BUY this token:";
        } else if (actionType === "sell") {
            newState = "awaiting_custom_sell_amount";
            prompt = "How much of your tokens would you like to sell?\n\nPlease reply with the percentage.";
        }

        const updatedStep = {
            ...step,
            state: newState,
            tokenAddress: selectedTokenAddress,
            currentIndex: index,
            mode: actionType,
            handlerType: "position"
        };
        await saveUserStep(userId, updatedStep);

        return ctx.reply(prompt, {
            reply_markup: { force_reply: true },
        });
    }

    const tokenSymbol =
        selectedToken?.symbol ||
        selectedToken?.metadata?.symbol ||
        selectedToken?.coinSymbol ||
        selectedToken?.coinType?.split("::")?.[2] ||
        "Unknown";

    let amountLine = "";
    if (isBuy) {
        amountLine = `${amount} SUI\n`;
    } else {
        amountLine = `${amount} %\n`;
    }

    const confirmationMessage =
        `${isBuy ? "💰" : "💸"} Confirm ${actionType.toUpperCase()}\n\n` +
        `Token: $${tokenSymbol}\n` +
        amountLine +
        `Action: ${actionType === "buy" ? "BUY" : "SELL"}\n\n` +
        `Do you want to proceed?`;

    const confirmKey = `confirm_${actionType}_${index}`;

    await saveUserStep(userId, {
        ...step,
        [confirmKey]: {
            tokenAddress: selectedTokenAddress, // full address
            amount,                              // string, e.g. "25"
        },
    });

    const confirmationKeyboard = {
        inline_keyboard: [
            [
                {
                    text: `✅ Confirm ${actionType.toUpperCase()}`,
                    // Use the short key as callback_data
                    callback_data: confirmKey,
                },
            ],
            [{ text: "❌ Cancel", callback_data: `view_pos_idx_${index}` }],
        ],
    };

    return safeEditMessage(ctx, confirmationMessage, {
        parse_mode: "HTML",
        reply_markup: confirmationKeyboard,
    });

};


export const handleConfirmBuySell = async (ctx, action) => {
    const userId = ctx.from.id;
    const isBuy = action.startsWith("confirm_buy_");
    const actionType = isBuy ? "buy" : "sell";

    // action is like: "confirm_buy_0" or "confirm_sell_1"
    const parts = action.split("_"); // ["confirm", "buy", "0"]
    const index = parts[2];          // index

    const user = await getUser(userId);
    const step = user?.step || {};

    const confirmData = step[action]; // we saved this with the same key
    if (!confirmData) {
        return ctx.answerCbQuery("❌ Confirmation data missing or expired.");
    }

    const { tokenAddress, amount } = confirmData;

    await ctx.answerCbQuery(`🔄 Executing ${actionType} order...`);

    try {
        const wallets = user.wallets || [];
        const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
        const walletKey = `wallet_${index}`;
        const walletAddress = step.walletMap?.[walletKey];
        const currentWallet = wallets.find(
            w => (w.address || w.walletAddress)?.toLowerCase() === walletAddress?.toLowerCase()
        );

        let userPhrase;
        try {
            const encrypted = currentWallet?.seedPhrase || currentWallet?.privateKey;
            const decrypted = decryptWallet(encrypted, ENCRYPTION_SECRET);
            if (typeof decrypted === "string") {
                userPhrase = decrypted;
            } else if (decrypted && typeof decrypted === "object") {
                userPhrase = decrypted.privateKey || decrypted.seedPhrase;
            }
            if (!userPhrase) throw new Error("Missing decrypted phrase or key.");
        } catch (err) {
            console.error(err);
        }

        if (!userPhrase || !walletAddress) throw new Error("Wallet or recovery phrase is not set.");

        const buySlippage = step.buySlippage;
        const sellSlippage = step.sellSlippage;

        const suiAmount = isBuy ? toSmallestUnit(parseFloat(amount)) : null;
        const suiPercentage = !isBuy ? parseInt(amount, 10) : null;

        await safeEditMessage(
            ctx,
            `⏳ Executing ${isBuy ? "buy" : "sell"} order for 1 wallet(s)...`
        );



        const result = isBuy
            ? await buyTokenWithAftermath({ tokenAddress, phrase: userPhrase, suiAmount, slippage: buySlippage })
            : await sellTokenWithAftermath({ tokenAddress, phrase: userPhrase, suiPercentage, slippage: sellSlippage });

        if (!result) throw new Error(`No result returned from ${actionType} call`);


        if (isBuy) {
            const { tokenAmountReceived, tokenSymbol, tokenAddress: actualTokenAddress, spentSUI, transactionDigest } = result;

            const rawAmount = result.tokenAmountReceived;
            const decimals = result.decimals ?? 9;
            const tokenAmountReadable = Number(result.tokenAmountSold) / 1e9;

            const humanAmount = rawAmount / (10 ** decimals);

            await saveOrUpdatePosition(userId, walletAddress, removeUndefined({
                tokenAddress: result.tokenAddress,
                symbol: result.tokenSymbol,
                amountBought: humanAmount,
                amountInSUI: result.spentSUI,
                decimals: decimals
            }));

            const walletLink = `https://suiscan.xyz/mainnet/account/${walletAddress}`;
            const txLink = `https://suiscan.xyz/mainnet/tx/${result.transactionDigest}`;

            const message =
                `<a href="${walletLink}">${currentWallet.name || shortAddress(walletAddress)}</a> ✅ ` +
                `Swapped ${formatNumber(result.spentSUI)} SUI ↔ ${formatNumber(result.tokenAmountReadable)} $${result.tokenSymbol}\n` +
                    `🔗 <a href="${txLink}">View Transaction Record on Explorer</a>`;

            await safeEditMessage(ctx, message, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh Positions", callback_data: `view_pos_idx_${index}` }],
                        [{ text: "← Main Menu", callback_data: "back_to_menu" }],
                    ],
                },
            });

        } else {
            const { tokenAmountSold, actualSuiReceived, tokenSymbol, transactionDigest } = result;
            const tokenAmountReadable = Number(result.tokenAmountSold) / 1e9;

            const txLink = `https://suiscan.xyz/mainnet/tx/${result.transactionDigest}`;
            const walletLink = `https://suiscan.xyz/mainnet/account/${walletAddress}`;

            const message =
                `<a href="${walletLink}">${currentWallet.name || shortAddress(walletAddress)}</a> ✅ ` +
                `Swapped ${formatNumber(tokenAmountReadable)} $${result.tokenSymbol ?? "??"} ↔ ${formatNumber(result.actualSuiReceived ?? 0)} SUI \n` +
                    `🔗 <a href="${txLink}">View Transaction Record on Explorer</a>`;

            await safeEditMessage(ctx, message, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh Positions", callback_data: `view_pos_idx_${index}` }],
                        [{ text: "← Main Menu", callback_data: "back_to_menu" }],
                    ],
                },
            });
        }

        // Auto-refresh after a short delay       
        setTimeout(() => {
            ctx.callbackQuery.data = `view_pos_idx_${index}`;
            handleViewPosition(ctx, ctx.callbackQuery.data);
        }, 3000);

    } catch (error) {
        console.error(`${actionType} order failed:`, error);
        await safeEditMessage(
            ctx,
            `❌ ${actionType.toUpperCase()} ORDER FAILED\n\n${error.message || error}\n\nPlease try again.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Try Again", callback_data: `view_pos_idx_${index}` }],
                        [{ text: "← Main Menu", callback_data: "back_to_menu" }],
                    ],
                },
            }
        );
    }
};