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
            try {
                await promptNewWalletsCount(ctx);
            } catch (error) {
                console.error('Error in generating multiple wallets', error);
            }
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

        case /^buy_\d+(:limit|:market|:dca)?$/.test(action):
        case /^buy_x(:limit|:market|:dca)?$/.test(action):
        case /^sell_\d+(:limit|:market|:dca)?$/.test(action):
        case /^sell_x(:limit|:market|:dca)?$/.test(action): {
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
            await ctx.answerCbQuery();
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

        case action === "nool": {
            try {
                await ctx.deleteMessage();
                // optional: go back to previous menu
                // await showPreviousMenu(ctx, ctx.from.id);
            } catch (err) {
                console.error("Failed to delete message:", err);
            }
            break;
        }

        default:
            return await ctx.reply("⚠️ Unknown command.");
    }
}