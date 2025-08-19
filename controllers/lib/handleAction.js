import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js";
import { generateQRCode } from "../qrcode/genQr.js";
import { handleWithdrawTokenAmount, handleWithdrawTokens } from "../tokens/withdrawToken.js";
import { handleBuySlippage, handleSellSlippage } from "./buySlippage.js";
import { handleCancelToMain } from "./cancelToMain.js";
import { fetchUserStep } from "./db.js";
import { savePendingLimitOrder } from "./db.js";
import { saveOrUpdatePosition } from "./db.js";
import { saveUserStep } from "./db.js";
import { addWalletToUser, getUser } from "./db.js";
import { handleDcaOrder, handleDcaSetDuration, handleDcaSetInterval } from "./dcaOrder.js";
import { decryptWallet, encryptWallet } from "./generateWallet.js";
import { generateNewWallet } from "./genNewWallet.js";
import { handleBuy } from "./handleBuy.js";
import { handleConfig } from "./handleConfig.js";
import { handleConnectWallet } from "./handleConnectWallet.js";
import { renderMainMessage } from "./handleLimitKeyboard.js";
import { handleViewPnL } from "./handlePnl.js";
import { handleReferrals } from "./handleReferrals.js";
import { handleSell } from "./handleSell.js";
import { handleStart } from "./handleStart.js";
import { handleBuySellAmount, handleConfirmBuySell, handleSelectToken, handleToggleBuySell } from "./handleTogglePosition.js";
import { handleViewPosition } from "./handleViewPosition.js";
import { handleWallets } from "./handleWallets.js";
import { handleEnterMcap, handleLimitOrder } from "./limitOrder.js";
import { handleBackToMenu, handleRefreshInfo } from "./refresh.js";
import { shortAddress } from "./shortAddress.js";
import { handlePositionsWalletList, showWalletsForPositions } from "./showWalletsForPositions.js";
import { toSmallestUnit } from "./suiAmount.js";
import { handleToggleAllWallets, handleToggleMode, handleToggleWallet } from "./toggle.js";
import { userSteps } from "./userState.js";
import { handleConfirmDeleteWallet, handleDeleteWalletPrompt, handleRenameWalletPrompt, handleWalletInfo } from "./walletName.js";
import { handleConfirmWithdraw, handleWithdrawSui } from "./withdraw.js";

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
            await ctx.answerCbQuery("📊 Loading PnL...");
            return await handleViewPnL(ctx, index);
        }

        case action === "referral": {
            await handleReferrals(ctx, userId);
            break;
        }

        case (action === 'show_qr'): {
            const userId = ctx.from.id.toString();
            const referralLink = `https://t.me/${ctx.me}?start=ref_${userId}`;
            const qrImageBuffer = await generateQRCode(referralLink); // your custom function
            await ctx.replyWithPhoto({ source: qrImageBuffer }, { caption: "Here's your referral QR code." });

            await ctx.answerCbQuery();
            break;
        }

        case (action === 'close_msg'): {
            try {
                await ctx.deleteMessage();
            } catch (err) {
                console.error("❌ Couldn't delete message:", err.message);
            }
            await ctx.answerCbQuery("Closed.");
            break;
        }

        case action === "config": {
            await handleConfig(ctx, userId);
            break;
        }

        case action === "new_wallet": {
            try {
                const userId = ctx.from.id;
                const wallet = await generateNewWallet(userId);
                const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
                const rawPrivateKey = wallet.privateKey;
                const encryptedPrivateKey = encryptWallet(wallet.privateKey, ENCRYPTION_SECRET);
                const encryptedSeedPhrase = encryptWallet(wallet.seedPhrase, ENCRYPTION_SECRET);
                const { walletAddress, privateKey, seedPhrase } = wallet;
                const newWallet = {
                    walletAddress,
                    privateKey: encryptedPrivateKey,
                    seedPhrase: encryptedSeedPhrase,
                    balance: "0.0"
                }
                await addWalletToUser(userId.toString(), newWallet);
                await ctx.answerCbQuery("✅ Wallet created!");
                let message = '';
                message += `✅ New wallet created!\n\n`;
                message += `Address: <code>${walletAddress}</code> (tap to copy)\n\n`;
                message += `Private key: <code>${rawPrivateKey}</code> (tap to copy)\n\n`;
                message += "⚠ Save your private key on paper only. Avoid storing it digitally. After you finish saving/importing the wallet credentials, delete this message. The bot will not display this information again.";
                // Clear sensitive data from memory
                wallet.privateKey = undefined;
                wallet.seedPhrase = undefined;
                return ctx.editMessageText(message, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "← Back to Wallets", callback_data: "wallets" }
                        ]]
                    }
                });
            } catch (error) {
                console.error("Error creating new wallet:", error);
                await ctx.answerCbQuery("❌ Failed to create wallet. Please try again.", { show_alert: true });
            }
            break;
        }

        case action === "x_new_wallets": {
            await saveUserStep(userId, {
                state: "awaiting_wallet_generation_count",
                flow: "generate_wallets"
            });

            await ctx.reply("How many wallets would you like to generate? (Maximum 10)", {
                reply_markup: {
                    force_reply: true
                }
            });
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
            const userId = ctx.from.id;
            const step = {
                state: "setting_buy_slippage",
                returnTo: "config",
            };

            await saveUserStep(userId, step);
            await handleBuySlippage(ctx, userId, step);
            break;
        }

        case action === "set_buy_slippage_all": {
            const userId = ctx.from.id;

            const promptMessage = await ctx.reply(
                "Enter buy slippage % for *all wallets* (e.g. 1)",
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        force_reply: true,
                    },
                }
            );

            await saveUserStep(userId, {
                state: "awaiting_slippage_input",
                scope: "all",
                type: "buy",
                returnTo: "config",
                mainMessageId: ctx.callbackQuery?.message?.message_id,
                promptMessageId: promptMessage.message_id,
            });

            break;
        }

        case typeof action === "string" &&
            action.startsWith("set_buy_slippage_"): {
                const userId = ctx.from.id;
                const index = parseInt(action.replace("set_buy_slippage_", ""));
                const user = await getUser(userId);
                const wallet = user.wallets?.[index];

                if (!wallet) {
                    await ctx.reply("❌ Wallet not found.");
                    return;
                }
                const address = wallet.walletAddress;
                const explorerLink = `https://suivision.xyz/account/${address}`;
                const display = wallet.name?.trim() || shortAddress(address);
                const message = `Enter buy slippage % for <a href="${explorerLink}">${display}</a>`;
                const promptMessage = await ctx.reply(message, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: {
                        force_reply: true,
                    },
                });

                await saveUserStep(userId, {
                    state: "awaiting_slippage_input",
                    scope: "wallet",
                    walletAddress: wallet.walletAddress,
                    walletKey: index,
                    slippageTarget: index,
                    type: "buy",
                    returnTo: "config",
                    mainMessageId: ctx.callbackQuery?.message?.message_id,
                    promptMessageId: promptMessage.message_id,
                });

                break;
            }

        case action === "sell_slippage": {
            const userId = ctx.from.id;
            const step = {
                state: "setting_sell_slippage",
                returnTo: "config",
            };

            await saveUserStep(userId, step);
            await handleSellSlippage(ctx, userId, step);
            break;
        }

        case action === "set_sell_slippage_all": {
            const userId = ctx.from.id;

            const promptMessage = await ctx.reply(
                "Enter sell slippage % for *all wallets* (e.g. 1)",
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        force_reply: true,
                    },
                }
            );

            await saveUserStep(userId, {
                state: "awaiting_slippage_input",
                scope: "all",
                type: "sell",
                returnTo: "config",
                mainMessageId: ctx.callbackQuery?.message?.message_id,
                promptMessageId: promptMessage.message_id,
            });

            break;
        }

        case typeof action === "string" &&
            action.startsWith("set_sell_slippage_"): {
                const userId = ctx.from.id;
                const index = parseInt(action.replace("set_sell_slippage_", ""));
                const user = await getUser(userId);
                const wallet = user.wallets?.[parseInt(index)];
                if (!wallet) {
                    await ctx.reply("❌ Wallet not found.");
                    return;
                }
                const address = wallet.walletAddress;
                const explorerLink = `https://suivision.xyz/account/${address}`;
                const display = wallet.name?.trim() || shortAddress(address);
                const message = `Enter sell slippage % for <a href="${explorerLink}">${display}</a>`;

                const promptMessage = await ctx.reply(message, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: {
                        force_reply: true,
                    },
                });
                await saveUserStep(userId, {
                    state: "awaiting_slippage_input",
                    scope: "wallet",
                    walletAddress: wallet.walletAddress,
                    walletKey: index,
                    slippageTarget: index,
                    type: "sell",
                    returnTo: "config",
                    mainMessageId: ctx.callbackQuery?.message?.message_id,
                    promptMessageId: promptMessage.message_id,
                });
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

        case /^buy_\d+(:limit|:market)?$/.test(action):
        case /^buy_x(:limit|:market)?$/.test(action):
        case /^sell_\d+(:limit|:market)?$/.test(action):
        case /^sell_x(:limit|:market)?$/.test(action): {
            const userId = ctx.from.id;
            const [baseAction, contextType] = action.split(":");
            const [mode, amountStr] = baseAction.split("_");
            const isLimitOrder = contextType === "limit";
            const isMarketOrder = contextType === "market";

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
            if (amountStr === "x") {
                const newState = mode === "buy" ? "awaiting_custom_buy_amount" : "awaiting_custom_sell_amount";
                await saveUserStep(userId, {
                    ...step,
                    state: newState,
                    orderMode: isLimitOrder ? "limit" : "market"
                });
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

            const parsedAmount = parseFloat(amountStr);
            const suiAmount = !isNaN(parsedAmount) && parsedAmount > 0 ? toSmallestUnit(parsedAmount) : null;
            const suiPercentage = parseInt(amountStr, 10);
            const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
            const results = [];
            await ctx.reply(`⏳ Executing ${mode} order for ${selectedWallets.length} wallet(s)...`);
            for (const wallet of selectedWallets) {
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
                const address = wallet.address || wallet.walletAddress;
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

                        results.push(`✅ ${wallet.name || shortAddress(address)}: Limit ${mode} order saved.`);
                    } else if (isMarketOrder) {
                        await ctx.reply(`⏳ Executing ${mode} order for ${selectedWallets.length} wallet(s)...`);
                        const result = mode === "buy"
                            ? await buyTokenWithAftermath({ tokenAddress: step.tokenAddress, phrase, suiAmount, slippage: step.buySlippage })
                            : await sellTokenWithAftermath({ tokenAddress: step.tokenAddress, phrase, suiPercentage, slippage: step.sellSlippage });

                        if (!result) throw new Error("No result returned");
                        if (mode === "buy") {
                            const rawAmount = result.tokenAmountReceived;
                            const decimals = result.decimals ?? 9;
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
                    }

                } catch (err) {
                    results.push(`❌ ${wallet.name || shortAddress(address)}: ${err.message || err}`);
                }
            }
            // Clear state after
            await saveUserStep(userId, {
                ...step,
                state: null,
                currentFlow: null,
                orderMode: null,
                limitTriggerValue: null,
            });
            await ctx.reply(results.join("\n\n"), { parse_mode: "HTML" });
            return ctx.answerCbQuery();
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

        case action === "back": {
            const userId = ctx.from.id;
            let step = await fetchUserStep(userId);
            if (!step) step = {};

            // Exit limit order flow cleanly
            delete step.isInLimitFlow;
            delete step.limitTriggerValue;
            step.currentFlow = null;

            // ✅ DO NOT delete tokenInfo or mode — required for re-render
            await saveUserStep(userId, step);

            // Re-render token info view with full keyboard and balances
            await renderMainMessage(ctx, userId);

            return ctx.answerCbQuery("🔙 Back to token info");
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