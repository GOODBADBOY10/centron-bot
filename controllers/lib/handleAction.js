import { showWalletsForOrders } from "../manageOrders/limitAndDca.js";
import { closeMessage, showReferralQRCode } from "../qrcode/genQr.js";
import { handleWithdrawTokenAmount, handleWithdrawTokens } from "../tokens/withdrawToken.js";
import { handleCancelToMain } from "./cancelToMain.js";
import { fetchUserStep, saveOrUpdatePosition, saveUserStep } from "./db.js";
import { handleDcaOrder, handleDcaSetDuration, handleDcaSetInterval, showDcaConfirmation } from "./dcaOrder.js";
import { handleBuy } from "./handleBuy.js";
import { handleConfig } from "./handleConfig.js";
import { handleConnectWallet } from "./handleConnectWallet.js";
import { handleViewPnL } from "./handlePnl.js";
import { handleReferrals } from "./handleReferrals.js";
import { handleSell } from "./handleSell.js";
import { handleStart } from "./handleStart.js";
import { handleBuySellAmount, handleConfirmBuySell, handleSelectToken, handleToggleBuySell } from "./handleTogglePosition.js";
import { handleViewPosition } from "./handleViewPosition.js";
import { handleWallets } from "./handleWallets.js";
import { handleEnterMcap, handleLimitOrder } from "./limitOrder.js";
import { handleBackToMenu, handleRefreshInfo } from "./refresh.js";
import { handlePositionsWalletList, showWalletsForPositions } from "./showWalletsForPositions.js";
import { handleToggleAllWallets, handleToggleMode, handleToggleWallet } from "./toggle.js";
import { userSteps } from "./userState.js";
import { handleConfirmDeleteWallet, handleDeleteWalletPrompt, handleRenameWalletPrompt, handleWalletInfo } from "./walletName.js";
import { handleConfirmWithdraw, handleWithdrawSui } from "./withdraw.js";
import { promptBuySlippageAll, promptBuySlippageForWallet, promptSellSlippageAll, promptSellSlippageForWallet, startBuySlippageFlow, startSellSlippageFlow } from "../prompt/promptSlippage.js";
import { handleBackAction } from "../prompt/back.js";
import { handleBuySellOrder } from "../prompt/buy.js";
import { createNewWallet, promptNewWalletsCount } from "../prompt/wallets.js";
import { toSmallestUnit } from "./suiAmount.js";
import { decryptWallet } from "./generateWallet.js";
import { shortAddress } from "./shortAddress.js";
import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { getFallbackTokenDetails } from "../../utils/getTokenDetails.js";
import { Dca } from "aftermath-ts-sdk/dist/packages/dca/dca.js";

export function removeUndefined(obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== undefined)
    );
}

export function formatNumber(num) {
    return Number(num).toLocaleString(undefined, { maximumFractionDigits: 6 });
}


export async function handleAction(ctx, action, userId) {
    switch (true) {

        case action === "start": {
            const userId = ctx.from.id;
            return await handleStart(ctx);
        }

        case action === "wallets": {
            const userId = ctx.from.id;
            return await handleWallets(ctx, userId);
        }

        case action === "buy": {
            await handleBuy(ctx, userId);
            break;
        }

        case action === "sell": {
            await handleSell(ctx, userId);
            break;
        }

        case action === "positions": {
            const userId = ctx.from.id.toString();
            await showWalletsForPositions(ctx, userId);
            break;
        }

        case action.startsWith("view_pos_idx_"): {
            return handleViewPosition(ctx, action);
        }

        case action.startsWith("toggle_buy_sell_idx_"): {
            return handleToggleBuySell(ctx, action);
        }

        case action.startsWith("select_token_idx_"): {
            return handleSelectToken(ctx, action);
        }

        case action.startsWith("buy_amount_"):
        case action.startsWith("sell_amount_"): {
            return handleBuySellAmount(ctx, action);
        }

        case action.startsWith("buy_custom_idx_"):
        case action.startsWith("sell_custom_idx_"): {
            return handleBuySellAmount(ctx, action.replace("custom", "amount_custom"));
        }

        case action.startsWith("confirm_buy_"):
        case action.startsWith("confirm_sell_"): {
            return handleConfirmBuySell(ctx, action);
        }

        case action === "back_to_positions_wallets": {
            const userId = ctx.from.id;
            return await handlePositionsWalletList(ctx, userId); // this function renders that wallet selection message
        }

        case /^refresh_position_idx_(\d+)$/.test(action): {
            const match = action.match(/^refresh_position_idx_(\d+)$/);
            if (!match) return ctx.answerCbQuery("⚠️ Invalid refresh action");

            const index = match[1];
            await ctx.answerCbQuery("🔄 Refreshing tokens...");
            return await handleViewPosition(ctx, `view_pos_idx_${index}`);
        }

        case /^view_pnl_card_idx_(\d+)$/.test(action): {
            const index = action.match(/^view_pnl_card_idx_(\d+)$/)[1];
            await ctx.answerCbQuery("Loading PnL...");
            return await handleViewPnL(ctx, index);
        }

        case action === "referral": {
            await handleReferrals(ctx, userId);
            break;
        }

        case (action === 'show_qr'): {
            await showReferralQRCode(ctx);
            break;
        }

        case (action === 'close_msg'): {
            await closeMessage(ctx);
            break;
        }

        case action === "config": {
            await handleConfig(ctx, userId);
            break;
        }

        case action === "new_wallet": {
            await createNewWallet(ctx);
            break;
        }

        case action === "x_new_wallets": {
            await promptNewWalletsCount(ctx);
            break;
        }

        case action === "back_to_menu": {
            return handleBackToMenu(ctx);
        }

        case action === "connect_wallet": {
            const userId = ctx.from.id;
            return await handleConnectWallet(ctx, userId);
        }

        case action === "buy_slippage": {
            await startBuySlippageFlow(ctx);
            break;
        }

        case action === "set_buy_slippage_all": {
            await promptBuySlippageAll(ctx);
            break;
        }

        case typeof action === "string" && action.startsWith("set_buy_slippage_"): {
            const index = parseInt(action.replace("set_buy_slippage_", ""));
            await promptBuySlippageForWallet(ctx, index);
            break;
        }

        case action === "sell_slippage": {
            await startSellSlippageFlow(ctx);
            break;
        }

        case action === "set_sell_slippage_all": {
            await promptSellSlippageAll(ctx);
            break;
        }

        case typeof action === "string" && action.startsWith("set_sell_slippage_"): {
            const index = parseInt(action.replace("set_sell_slippage_", ""));
            await promptSellSlippageForWallet(ctx, index);
            break;
        }

        case action === "back_to_config": {
            const userId = ctx.from.id.toString();
            return await handleConfig(ctx, userId);
        }

        case /^wallet_\d+$/.test(action): {
            return handleWalletInfo(ctx, action);
        }

        case /^delete_wallet_\d+$/.test(action): {
            return handleDeleteWalletPrompt(ctx, action);
        }

        case /^confirm_delete_wallet_\d+$/.test(action): {
            return handleConfirmDeleteWallet(ctx, action);
        }

        case /^rename_wallet_\d+$/.test(action): {
            return handleRenameWalletPrompt(ctx, action);
        }

        case action === "refresh_info": {
            return handleRefreshInfo(ctx);
        }

        // case /^buy_\d+(:limit|:market|:dca)?$/.test(action):
        // case /^buy_x(:limit|:market|:dca)?$/.test(action):
        // case /^sell_\d+(:limit|:market|:dca)?$/.test(action):
        // case /^sell_x(:limit|:market|:dca)?$/.test(action): {
        //     const userId = ctx.from.id;
        //     const [baseAction, contextType] = action.split(":");
        //     const [mode, amountStr] = baseAction.split("_");
        //     const isLimitOrder = contextType === "limit";
        //     const isMarketOrder = contextType === "market";
        //     const isDcaOrder = contextType === "dca";

        //     const step = await fetchUserStep(userId);
        //     if (!step) return ctx.reply("❌ Session expired. Please start again.");

        //     const user = await getUser(userId);
        //     const wallets = user.wallets || [];

        //     if (!step.tokenAddress) {
        //         return ctx.reply("❌ No token selected. Please enter a token address first.");
        //     }

        //     const selectedWallets = (step.selectedWallets || []).map(k => step.walletMap?.[k]).filter(Boolean);
        //     if (selectedWallets.length === 0) {
        //         return ctx.reply("❌ No wallet selected.");
        //     }
        //     if (amountStr === "x") {
        //         const newState = mode === "buy" ? "awaiting_custom_buy_amount" : "awaiting_custom_sell_amount";

        //         let orderMode = "market";
        //         if (isLimitOrder) {
        //             orderMode = "limit";
        //         } else if (isDcaOrder) {
        //             orderMode = "dca";
        //         }

        //         await saveUserStep(userId, {
        //             ...step,
        //             state: newState,
        //             orderMode,
        //             // orderMode: isLimitOrder ? "limit" : "market"
        //         });
        //         if (mode === "buy") {
        //             return ctx.reply(
        //                 `How much SUI would you like to use for the token purchase?\n\nPlease reply with the amount.`,
        //                 { parse_mode: "Markdown", reply_markup: { force_reply: true } }
        //             );
        //         } else {
        //             return ctx.reply(
        //                 `How much of your tokens would you like to sell?\n\nPlease reply with the percentage.`,
        //                 { parse_mode: "Markdown", reply_markup: { force_reply: true } }
        //             );
        //         }
        //     }

        //     const parsedAmount = parseFloat(amountStr);
        //     const suiAmount = !isNaN(parsedAmount) && parsedAmount > 0 ? toSmallestUnit(parsedAmount) : null;
        //     const suiPercentage = parseInt(amountStr, 10);
        //     const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
        //     const results = [];
        //     await ctx.reply(`⏳ Executing ${mode} order for ${selectedWallets.length} wallet(s)...`);
        //     for (const wallet of selectedWallets) {
        //         let phrase;
        //         try {
        //             const encrypted = wallet.seedPhrase || wallet.privateKey;
        //             const decrypted = decryptWallet(encrypted, ENCRYPTION_SECRET);
        //             if (typeof decrypted === "string") {
        //                 phrase = decrypted;
        //             } else if (decrypted && typeof decrypted === "object") {
        //                 phrase = decrypted.privateKey || decrypted.seedPhrase;
        //             }
        //             if (!phrase) throw new Error("Missing decrypted phrase or key.");
        //         } catch (err) {
        //             results.push(`❌ ${wallet.name || shortAddress(wallet.address)}: Failed to decrypt wallet.`);
        //             continue;
        //         }
        //         const address = wallet.address || wallet.walletAddress;
        //         try {
        //             if (isLimitOrder) {
        //                 if (!step.limitTriggerValue) {
        //                     results.push(`❌ ${wallet.name || shortAddress(address)}: Missing trigger value.`);
        //                     continue;
        //                 }

        //                 await savePendingLimitOrder({
        //                     userId,
        //                     walletAddress: address,
        //                     tokenAddress: step.tokenAddress,
        //                     mode,
        //                     suiAmount,
        //                     suiPercentage,
        //                     triggerValue: step.limitTriggerValue,
        //                     slippage: mode === "buy" ? step.buySlippage : step.sellSlippage,
        //                 });
        //                 const formattedTrigger = formatMarketCapValue(step.limitTriggerValue);

        //                 results.push(
        //                     `✅ Limit ${mode} order saved for <b>${amount}${mode === "buy" ? " SUI" : "%"}</b> and will trigger at <b>$${formattedTrigger}</b> market cap.`
        //                 );
        //             } else if (isDcaOrder) {
        //                 if (!step.dcaDuration || !step.dcaInterval) {
        //                     results.push(`❌ ${wallet.name || shortAddress(address)}: Missing DCA duration or interval.`);
        //                     continue;
        //                 }
        //                 await saveUserStep(userId, {
        //                     ...step,
        //                     pendingOrder: {
        //                         mode,
        //                         suiAmount,
        //                         suiPercentage,
        //                         type: "dca"
        //                     },
        //                     state: "awaiting_dca_confirmation"
        //                 });
        //                 return showDcaConfirmation(ctx, userId, step, { mode, suiAmount });

        //             } else if (isMarketOrder) {
        //                 const result = mode === "buy"
        //                     ? await buyTokenWithAftermath({ tokenAddress: step.tokenAddress, phrase, suiAmount, slippage: step.buySlippage })
        //                     : await sellTokenWithAftermath({ tokenAddress: step.tokenAddress, phrase, suiPercentage, slippage: step.sellSlippage });

        //                 if (!result) throw new Error("No result returned");
        //                 const decimals = result.decimals ?? 9;
        //                 if (mode === "buy") {
        //                     const rawAmount = result.tokenAmountReceived;
        //                     // const decimals = result.decimals ?? 9;
        //                     const humanAmount = rawAmount / (10 ** decimals);

        //                     const tokenInfo = await getFallbackTokenDetails(result.tokenAddress, address);

        //                     await saveOrUpdatePosition(userId, address, removeUndefined({
        //                         tokenAddress: result.tokenAddress,
        //                         symbol: result.tokenSymbol,
        //                         amountBought: humanAmount,
        //                         amountInSUI: result.spentSUI,
        //                         decimals: decimals,
        //                         marketCap: tokenInfo?.tokenInfo?.marketCap ?? null,
        //                     }));
        //                 }
        //                 const txLink = `https://suiscan.xyz/mainnet/tx/${result.transactionDigest}`;
        //                 const walletLink = `https://suiscan.xyz/mainnet/account/${address}`;
        //                 const tokenAmountReadable = Number(result.tokenAmountSold) / (10 ** decimals);
        //                 // const tokenAmountReadable = Number(result.tokenAmountSold) / 1e9;
        //                 results.push(
        //                     `<a href="${walletLink}">${wallet.name || shortAddress(address)}</a> ✅ ${mode === "buy"
        //                         ? `Swapped ${formatNumber(result.spentSUI)} SUI ↔ ${formatNumber(result.tokenAmountReadable)} $${result.tokenSymbol}`
        //                         : `Swapped ${formatNumber(tokenAmountReadable)} $${result.tokenSymbol ?? "??"} ↔ ${formatNumber(result.actualSuiReceived ?? 0)} SUI`
        //                     }\n🔗 <a href="${txLink}">View Transaction Record on Explorer</a>`
        //                 );
        //             }

        //         } catch (err) {
        //             const msg = typeof err?.message === "string" ? err.message : "Unknown error";
        //             results.push(`❌ ${wallet.name || shortAddress(address)}: ${msg}`);
        //         }
        //     }
        //     // Clear state after
        //     await saveUserStep(userId, { userId, state: null });
        //     // await saveUserStep(userId, {
        //     // ...step,
        //     // state: null,
        //     // currentFlow: null,
        //     // orderMode: null,
        //     // limitTriggerValue: null,
        //     // });
        //     await ctx.reply(results.join("\n\n"), { parse_mode: "HTML" });
        //     return ctx.answerCbQuery();
        // }

        case /^buy_\d+(:limit|:market|:dca)?$/.test(action):
        case /^buy_x(:limit|:market|:dca)?$/.test(action):
        case /^sell_\d+(:limit|:market|:dca)?$/.test(action):
        case /^sell_x(:limit|:market|:dca)?$/.test(action): {
            console.log(`action: ${action}`);
            try {
                await handleBuySellOrder(ctx, action);
            } catch (error) {
                console.error("Error handling in the action of Dca", error)
            }
            break;
        }

        case action.startsWith("withdraw_sui_"): {
            return handleWithdrawSui(ctx, action);
        }

        case action === "confirm_withdraw": {
            return handleConfirmWithdraw(ctx);
        }

        case action === "cancel_withdraw": {
            const userId = ctx.from.id;
            await saveUserStep(userId, null);
            await ctx.editMessageText("❌ Withdrawal cancelled.");
            break;
        }

        case action.startsWith("withdraw_tokens_"): {
            return handleWithdrawTokens(ctx, action);
        }

        case action.startsWith("withdraw_token_"): {
            return handleWithdrawTokenAmount(ctx, action);
        }

        case action === "limit_order": {
            return handleLimitOrder(ctx);
        }

        case action === "enter_mcap": {
            return handleEnterMcap(ctx);
        }

        case action === "dca_order": {
            return handleDcaOrder(ctx);
        }

        case action === "dca_set_duration": {
            return handleDcaSetDuration(ctx);
        }

        case action === "dca_set_interval": {
            return handleDcaSetInterval(ctx);
        }

        case action === "manage_orders": {
            return await showWalletsForOrders(ctx, userId);
        }

        case action === "back": {
            await handleBackAction(ctx);
            break;
        }

        case action.startsWith("toggle_wallet:"): {
            return handleToggleWallet(ctx, action);
        }

        case action === "toggle_mode": {
            return handleToggleMode(ctx);
        }

        case action === "toggle_all_wallets": {
            return handleToggleAllWallets(ctx);
        }

        case action === "cancel": {
            delete userSteps[userId];
            await ctx.answerCbQuery("❌ Cancelled");
            await ctx.reply("Action cancelled.");
            break;
        }

        case action === "cancel_to_main": {
            return handleCancelToMain(ctx);
        }

        default:
            return await ctx.reply("⚠️ Unknown command.");
    }
}