import { getFallbackTokenDetails, getSuiUsdPrice } from "../../utils/getTokenDetails.js";
import { buildActionRows, buildFooterRows, buildTokenInlineRows } from "../../utils/keyboard/keyboardBuilder.js";
import { formatPositionSummary } from "../../utils/positions.js";
import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { saveOrUpdatePosition, saveUserStep, getUserPositions, fetchUser, getUser } from "./db.js";
import { handleViewPosition } from "./handleViewPosition.js";
import { getTokenPositions } from "./showWalletsForPositions.js";
import { toSmallestUnit } from "./suiAmount.js";


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

        // 🔄 Reorder positions by saved order
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
        };

        saveUserStep(userId, removeUndefined(updatedStep)).catch(console.error);

        // Rebuild keyboard only (no full message redraw)
        const tokenRows = buildTokenInlineRows(orderedPositions, tokenAddress, index);
        const actionButtons = buildActionRows(currentMode, index);
        const footer = buildFooterRows(index);
        const inline_keyboard = [...tokenRows, ...actionButtons, ...footer];

        await ctx.editMessageReplyMarkup({ inline_keyboard });
        return ctx.answerCbQuery("✅ Token selected");

    } catch (error) {
        return ctx.answerCbQuery("❌ Failed to select token");
    }
};


export const handleBuySellAmount = async (ctx, action) => {
    const userId = ctx.from.id.toString();
    const isBuy = action.startsWith("buy_amount_");
    const actionType = isBuy ? "buy" : "sell";


    const match = action.match(/(buy|sell)_amount_(\d+|custom)_idx_(\d+)/);
    if (!match) {
        return ctx.answerCbQuery("Invalid action");
    }

    const amount = match[2];
    const index = match[3];

    const user = await fetchUser(userId);
    const step = user?.step || {};

    const selectedTokenKey = `selectedToken_${index}`;
    const selectedTokenAddress = step[selectedTokenKey];

    if (!selectedTokenAddress) {
        return ctx.answerCbQuery("⚠ Please select a token first");
    }

    const tokenMap = step[`tokenMap_${index}`] || {};

    const tokenKey = Object.entries(tokenMap).find(([_, val]) => val === selectedTokenAddress)?.[0];

    if (!tokenKey) {
        return ctx.answerCbQuery("⚠ Token key not found");
    }

    const walletKey = `wallet_${index}`;
    const walletAddress = step.walletMap?.[walletKey];

    if (!walletAddress) {
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
        return ctx.answerCbQuery("⚠ Selected token not found in wallet");
    }

    // Handle custom input
    if (amount === "custom") {
        const updatedStep = {
            ...step,
            state: isBuy ? "awaiting_custom_buy_amount" : "awaiting_custom_sell_amount",
            tokenAddress: selectedTokenAddress,
            currentIndex: index,
            mode: actionType,
            handlerType: "position"
        };
        await saveUserStep(userId, updatedStep);

        return ctx.reply(`✍️ Please enter how much SUI you want to ${actionType}:`, {
            reply_markup: { force_reply: true },
        });
    }

    const tokenSymbol =
        selectedToken?.symbol ||
        selectedToken?.metadata?.symbol ||
        selectedToken?.coinSymbol ||
        selectedToken?.coinType?.split("::")?.[2] ||
        "Unknown";

    const confirmationMessage =
        `${isBuy ? "💰" : "💸"} Confirm ${actionType.toUpperCase()}\n\n` +
        `Token: $${tokenSymbol}\n` +
        `Amount: ${amount} SUI\n` +
        `Action: ${actionType === "buy" ? "Buy" : "Sell"}\n\n` +
        `Are you sure?`;

    const confirmationKeyboard = {
        inline_keyboard: [
            [
                {
                    text: `✅ Confirm ${actionType.toUpperCase()}`,
                    callback_data: `confirm_${actionType}_${index}_${tokenKey}_${amount}`
                }
            ],
            [{ text: "❌ Cancel", callback_data: `view_pos_idx_${index}` }]
        ]
    };

    return ctx.editMessageText(confirmationMessage, {
        parse_mode: "HTML",
        reply_markup: confirmationKeyboard
    });
};


export const handleConfirmBuySell = async (ctx, action) => {

    const userId = ctx.from.id;
    const isBuy = action.startsWith("confirm_buy_");
    const actionType = isBuy ? "buy" : "sell";
    const index = action.split("_").pop();

    const user = await getUser(userId);
    const step = user?.step || {};
    const confirmData = step[action];

    if (!confirmData) {
        return ctx.answerCbQuery("❌ Confirmation data missing or expired.");
    }

    const { tokenAddress, amount } = confirmData;

    await ctx.answerCbQuery(`🔄 Executing ${actionType} order...`);

    try {
        const wallets = user.wallets || [];

        const walletKey = `wallet_${index}`;
        const walletAddress = step.walletMap?.[walletKey];
        const currentWallet = wallets.find(
            w => (w.address || w.walletAddress)?.toLowerCase() === walletAddress?.toLowerCase()
        );

        const userPhrase = currentWallet?.seedPhrase || currentWallet.privateKey || null;
        if (!userPhrase || !walletAddress) throw new Error("Wallet or recovery phrase is not set.");

        const buySlippage = step.buySlippage;
        const sellSlippage = step.sellSlippage;

        const suiAmount = isBuy ? toSmallestUnit(parseFloat(amount)) : null;
        const suiPercentage = !isBuy ? parseInt(amount, 10) : null;

        // Show loading state
        try {
            await ctx.editMessageText(`⏳ ${isBuy ? "Buying" : "Selling"} token...`, {
                reply_markup: {
                    inline_keyboard: [[{ text: "⏳ Processing...", callback_data: "processing" }]]
                }
            });
        } catch (e) { }

        const result = isBuy
            ? await buyTokenWithAftermath({ tokenAddress, phrase: userPhrase, suiAmount, slippage: buySlippage })
            : await sellTokenWithAftermath({ tokenAddress, phrase: userPhrase, suiPercentage, slippage: sellSlippage });

        if (!result) throw new Error(`No result returned from ${actionType} call`);

        if (isBuy) {
            const { tokenAmountReceived, tokenSymbol, tokenAddress: actualTokenAddress, spentSUI } = result;

            await saveOrUpdatePosition(userId, walletAddress, {
                tokenAddress: actualTokenAddress || tokenAddress,
                symbol: tokenSymbol,
                amountBought: tokenAmountReceived,
                amountInSUI: spentSUI
            });

            const message = `✅ BUY ORDER EXECUTED!\n\n` +
                `💰 Amount: ${amount} SUI\n` +
                `🪙 Token: ${tokenSymbol}\n` +
                `📈 Received: ${tokenAmountReceived} ${tokenSymbol}\n` +
                `💸 Spent: ${spentSUI} SUI\n` +
                `⏰ Time: ${new Date().toLocaleTimeString()}`;

            await ctx.editMessageText(message, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh Positions", callback_data: `view_pos_idx_${index}` }],
                        [{ text: "← Main Menu", callback_data: "back_to_menu" }]
                    ]
                }
            });

        } else {
            const message = `✅ SELL ORDER EXECUTED!\n\n` +
                `💸 Percentage: ${amount}%\n` +
                `🎯 Token: ${tokenAddress.slice(0, 10)}...\n` +
                `⏰ Time: ${new Date().toLocaleTimeString()}`;

            await ctx.editMessageText(message, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh Positions", callback_data: `view_pos_idx_${index}` }],
                        [{ text: "← Main Menu", callback_data: "back_to_menu" }]
                    ]
                }
            });
        }

        // Optionally auto-refresh after a delay
        setTimeout(() => {
            ctx.callbackQuery.data = `view_pos_idx_${index}`;
            handleViewPosition(ctx);
        }, 3000);

    } catch (error) {
        await ctx.editMessageText(`❌ ${actionType.toUpperCase()} ORDER FAILED\n\n${error.message || error}\n\nPlease try again.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔄 Try Again", callback_data: `view_pos_idx_${index}` }],
                    [{ text: "← Main Menu", callback_data: "back_to_menu" }]
                ]
            }
        });
    }
};