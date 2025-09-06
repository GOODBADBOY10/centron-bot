import { Telegraf } from "telegraf";
import { session } from 'telegraf';
import { handleAction } from "./handleAction.js";
import { handleWallets } from "./handleWallets.js";
import { fetchUserStep, getUser, savePendingDcaOrder } from "./db.js";
import { handleConfig } from "./handleConfig.js";
import { handleReferrals } from "./handleReferrals.js";
import { handleBuy } from "./handleBuy.js";
import { handleSell } from "./handleSell.js";
import { handleStart } from "./handleStart.js";
import { handleSellTokenAddressFlow } from "./handleSellTokenAddress.js";
import { handleBuyTokenAddressFlow } from "./handleBuyTokenAddress.js";
import { handleDcaInput, handleLimitTriggerValueInput } from "./handleLimitTriggerValue.js";
import { handleSlippageInput } from "./handleSlippageInput.js";
import { handleCustomAmountInput } from "./handleCustomAmountInput.js";
import { handleWithdrawAddressInput, handleWithdrawAmountInput } from "./handleWithdrawAddressInput.js";
import { handleRenameWallet } from "./handleRenameWallet.js";
import { handleWalletGenerationRequest } from "./handleWalletGenRequest.js";
import { handleWalletImport } from "./handleWalletImport.js";
import { showWalletsForPositions } from "./showWalletsForPositions.js";
import { saveUserStep, clearUserStep } from "./db.js";
import { handleExecuteTokenWithdraw, handleWithdrawTokenAddress } from "../tokens/withdrawToken.js";
import { decryptWallet } from "./generateWallet.js";
import { handleCancel } from "./handleCancel.js";
import { formatDuration, formatSui } from "../manageOrders/formater.js";
import { checkUserOrders, getUserOrders, showWalletsForOrders } from "../manageOrders/limitAndDca.js";
import { shortAddress } from "./shortAddress.js";

export const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

bot.start(handleStart);


bot.command("wallets", async (ctx) => {
  const userId = ctx.from.id;
  return await handleWallets(ctx, userId);
});

bot.command("config", async (ctx) => {
  const userId = ctx.from.id;
  return await handleConfig(ctx, userId);
});

bot.command("referral", async (ctx) => {
  const userId = ctx.from.id;
  await handleReferrals(ctx, userId);
});

bot.command("buy", async (ctx) => {
  const userId = ctx.from.id;
  await handleBuy(ctx, userId);
});

bot.command("sell", async (ctx) => {
  const userId = ctx.from.id;
  await handleSell(ctx, userId);
});

bot.command("positions", async (ctx) => {
  const userId = ctx.from.id;
  await showWalletsForPositions(ctx, userId);
});

bot.command("cancel", async (ctx) => {
  const userId = ctx.from.id;
  await handleCancel(ctx, userId);
});

bot.command("orders", async (ctx) => {
  const userId = ctx.from.id;
  const { hasOrders } = await checkUserOrders(userId);
  if (!hasOrders) {
    return ctx.reply("❌ You do not have any limit or DCA orders yet.");
  }

  await showWalletsForOrders(ctx, userId);
});

// Matches anything like "view_orders_idx_0", "view_orders_idx_1", etc.
bot.action(/^view_orders_idx_(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const index = ctx.match[1]; // wallet index

  const step = await fetchUserStep(userId);
  const walletAddress = step.walletMap[`wallet_${index}`];

  const { limitOrders, dcaOrders } = await getUserOrders(userId);

  const walletLimit = limitOrders.filter(o => o.walletAddress === walletAddress);
  const walletDca = dcaOrders.filter(o => o.walletAddress === walletAddress);

  if (walletLimit.length === 0 && walletDca.length === 0) {
    await ctx.answerCbQuery(
      // "Centron Bot \n\nYou do not have any limit or DCA orders yet",
      "You do not have any limit or DCA orders yet",
      { show_alert: true }
    );
    return;
  }

  // Combine orders to get unique tokens
  const allOrders = [...walletLimit, ...walletDca];
  const tokenMap = {}; // key: token_0, token_1, ...
  const tokenNames = {}; // store display names

  allOrders.forEach((o) => {
    const tokenName = o.tokenAddress.split("::").pop(); // crude symbol extraction
    if (!Object.values(tokenMap).includes(o.tokenAddress)) {
      const tokenIndex = `token_${Object.keys(tokenMap).length}`;
      tokenMap[tokenIndex] = o.tokenAddress;
      tokenNames[tokenIndex] = tokenName;
    }
  });

  // Save tokenMap in user step for later lookup
  await saveUserStep(userId, {
    ...step,
    state: "awaiting_token_selection",
    walletMap: step.walletMap,
    tokenMap,
  });

  // Build keyboard
  const keyboard = Object.keys(tokenMap).map((tokenIndex) => ([{
    text: `${tokenNames[tokenIndex]}`,
    callback_data: `view_token_orders_${index}_${tokenIndex}`
  }]));

  // Add back button
  keyboard.push([{ text: "← Back", callback_data: "manage_orders" }]);

  // Message header
  const msg = `Select a token to see a list of active Limit & DCA Orders for ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}:`;

  await ctx.editMessageText(msg, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard }
  });

});


bot.action(/^view_token_orders_(\d+)_token_(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const walletIndex = ctx.match[1];
  const tokenIndex = ctx.match[2];

  const step = await fetchUserStep(userId);
  const walletAddress = step.walletMap[`wallet_${walletIndex}`];
  const tokenAddress = step.tokenMap[`token_${tokenIndex}`];

  const { limitOrders, dcaOrders } = await getUserOrders(userId);

  const walletLimit = limitOrders.filter(o => o.walletAddress === walletAddress && o.tokenAddress === tokenAddress);
  const walletDca = dcaOrders.filter(o => o.walletAddress === walletAddress && o.tokenAddress === tokenAddress);

  const tokenName = tokenAddress.split("::").pop();

  let msg = `${tokenName} - <b>Limit Orders</b> for ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}\n\n`;

  // Limit Orders
  const buyLimit = walletLimit.filter(o => o.mode.toLowerCase() === "buy");
  const sellLimit = walletLimit.filter(o => o.mode.toLowerCase() === "sell");

  msg += `BUY:\n${buyLimit.length > 0 ? buyLimit.map(o => `<b>${formatSui(o.suiAmount)}</b> SUI at <b>$${o.triggerValue}</b>`).join("\n") : "No buy orders."}\n\n`;
  msg += `SELL:\n${sellLimit.length > 0 ? sellLimit.map(o => `<b>${formatSui(o.suiAmount)}</b> SUI at <b>$${o.triggerValue}</b>`).join("\n") : "No sell orders."}\n\n`;

  // DCA Orders
  msg += `${tokenName} - <b>DCA Orders</b> for ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}\n\n`;
  const buyDca = walletDca.filter(o => o.mode.toLowerCase() === "buy");
  const sellDca = walletDca.filter(o => o.mode.toLowerCase() === "sell");

  // BUY summary
  if (buyDca.length > 0) {
    const totalSui = buyDca.reduce((sum, o) => sum + Number(o.suiAmount), 0);
    const readableTotal = formatSui(totalSui);
    const interval = formatDuration(buyDca[0].intervalMinutes) || "?";
    const totalPeriod = formatDuration(buyDca[0].intervalDuration) || "?"; // use duration from order
    msg += `BUY:\nTotal <b>${readableTotal} SUI</b> worth of ${tokenName} through multiple payments with <b> interval ${interval}</b> for a <b>period of ${totalPeriod}</b>\n\n`;
  } else {
    msg += "BUY:\nNo buy orders.\n\n";
  }

  // SELL summary
  if (sellDca.length > 0) {
    const totalSui = sellDca.reduce((sum, o) => sum + Number(o.suiAmount), 0);
    const readableTotal = formatSui(totalSui);
    const interval = formatDuration(sellDca[0].intervalMinutes) || "?";
    const totalPeriod = formatDuration(sellDca[0].intervalDuration) || "?";

    msg += `SELL:\nTotal <b>${readableTotal} SUI</b> worth of ${tokenName} through multiple payments with <b> interval ${interval}</b> for a <b>period of ${totalPeriod}</b>\n`;
  } else {
    msg += "SELL:\nNo sell orders.\n";
  }



  const keyboard = [
    [
      { text: "➕ Limit Order", callback_data: "limit_order" },
      { text: "➕ DCA Order", callback_data: "dca_order" },
    ],
    [
      { text: "← Back", callback_data: `view_orders_idx_${walletIndex}` }
    ]
  ];

  await ctx.editMessageText(msg, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard }
  });
});

bot.action("confirm_dca", async (ctx) => {
  const userId = ctx.from.id;
  const step = await fetchUserStep(userId);

  if (!step || step.state !== "awaiting_dca_confirmation" || !step.pendingOrder) {
    return ctx.answerCbQuery("❌ No DCA order to confirm.");
  }

  const { mode, suiAmount, suiPercentage } = step.pendingOrder;
  const wallets = (step.selectedWallets || []).map(k => step.walletMap?.[k]).filter(Boolean);
  const results = [];

  for (const wallet of wallets) {
    await savePendingDcaOrder({
      userId,
      walletAddress: wallet.address,
      tokenAddress: step.tokenAddress,
      mode,
      suiAmount,
      suiPercentage,
      intervalMinutes: step.dcaIntervalMinutes,
      intervalDuration: step.dcaDurationMinutes,
      times: step.times,
      duration: step.dcaDuration,
      interval: step.dcaInterval,
      slippage: mode === "buy" ? step.buySlippage : step.sellSlippage,
    });

    const amountText = suiAmount
      ? (suiAmount / 1e9) + " SUI"
      : suiPercentage + "%";

    results.push(
      `✅ DCA ${mode.toUpperCase()} order saved for ${amountText} into $${step.tokenInfo?.symbol ?? "??"} ` +
      `with payments every ${step.dcaInterval} for ${step.dcaDuration} (${wallet.name || shortAddress(wallet.address)})`
    );
  }

  await ctx.editMessageText(results.join("\n"), { parse_mode: "HTML" });

  await saveUserStep(userId, { ...step, state: null, pendingOrder: null });
});


bot.action(/^confirm_dca_(.+)$/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const confirmId = ctx.match[1];

    const step = await fetchUserStep(userId);
    const pending = step?.dcaConfirmations?.[confirmId];

    if (!pending) {
      return ctx.reply("❌ No pending DCA order found or it expired.");
    }

    const { mode, tokenAddress, suiAmount, suiPercentage, intervalMinutes, times, duration, interval, slippage, walletAddresses } = pending;

    // 🔹 Save one order per wallet
    for (const walletAddress of walletAddresses) {
      await savePendingDcaOrder({
        userId,
        walletAddress,
        tokenAddress,
        mode,
        suiAmount,
        suiPercentage,
        intervalMinutes,
        times,
        duration,
        interval,
        slippage,
      });
    }

    // cleanup just this confirmId
    delete step.dcaConfirmations[confirmId];
    await saveUserStep(userId, step);

    // 🔹 Build wallet list string
    const walletList = (step.selectedWallets || [])
      .map(w => `💳 ${w.name || shortAddress(w.address)}`)
      .join("\n");

    await ctx.editMessageText(
      `✅ DCA ${mode.toUpperCase()} order saved for ` +
      `${suiAmount ? (suiAmount / 1e9) + " SUI" : suiPercentage + "%"}` +
      ` into $${step.tokenInfo?.symbol ?? "??"} ` +
      `with payments every ${interval} for ${duration}`,
      { parse_mode: "HTML" }
    );

  } catch (err) {
    console.error("❌ Failed to confirm DCA order:", err);
    return ctx.reply("❌ Something went wrong while saving your DCA order.");
  }
});


function normalize(seed) {
  return seed
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}


bot.on("message", async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text?.trim();
  const replyTo = ctx.message?.reply_to_message?.text;
  if (!text) return;

  const step = await fetchUserStep(userId);
  const input = text.trim();

  // 1️⃣ Handle active step first (takes precedence over everything else)
  if (step) {
    // dispatch step based on state/action/name
    // withdraw tokens: step 1
    if (step?.name === "withdraw_token_amount") {
      return await handleWithdrawTokenAddress(ctx, step, text);
    }

    //withdraw tokens: step 2
    if (step?.name === "withdraw_token_address") {
      await handleExecuteTokenWithdraw(ctx, step, text);
      step.name = null;
      return await saveUserStep(userId, step);
    }

    // Connecting Wallet
    if (step?.state === "awaiting_wallet_input") {
      return await handleWalletImport(ctx, userId);
    }

    // Multiple Wallet generation
    if (step?.state === "awaiting_wallet_generation_count" && step?.flow === "generate_wallets") {
      return await handleWalletGenerationRequest(ctx, userId);
    }

    // renaming of wallet
    if (step?.action === "renaming_wallet") {
      return await handleRenameWallet(ctx);
    }

    // slippage
    if (step?.state === "awaiting_slippage_input") {
      return await handleSlippageInput(ctx, step, userId, text);
    }

    // Withdraw SUI: step 1 (recipient)
    if (step?.action === "awaiting_withdraw_sui_address") {
      return await handleWithdrawAddressInput(ctx, step);
    }

    // Withdraw SUI: step 2 (amount)
    if (step?.action === "awaiting_withdraw_amount") {
      return await handleWithdrawAmountInput(ctx, step);
    }

    // Limit order trigger value
    if (step?.state === "awaiting_limit_trigger_value") {
      return await handleLimitTriggerValueInput(ctx, step);
    }

    // Dca Order
    if (step?.state === "awaiting_dca_duration" || step?.state === "awaiting_dca_interval") {
      return await handleDcaInput(ctx, step);
    }

    // Buy token flow    
    if (step?.state === "awaiting_buy_token_address") {
      return await handleBuyTokenAddressFlow(ctx, step);
    }

    // Sell token flow
    if (step?.state === "awaiting_sell_token_address") {
      return await handleSellTokenAddressFlow(ctx, step);
    }

    // Buy or Sell with custom input amount
    if (step?.state === "awaiting_custom_buy_amount" || step?.state === "awaiting_custom_sell_amount") {
      return await handleCustomAmountInput(ctx, step, userId);
    }

    // confirming of seed phrse of PK for first users
    if (step?.state === "confirming_seed_phrase") {
      const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
      const decryptedSeed = decryptWallet(step.expectedSeed, ENCRYPTION_SECRET);
      const decryptedPK = decryptWallet(step.expectedPrivateKey, ENCRYPTION_SECRET);
      const seedMatch = normalize(text) === normalize(decryptedSeed);
      const pkMatch = text === decryptedPK;

      if (seedMatch || pkMatch) {
        await ctx.reply("✅ Wallet connected successfully!");
        await clearUserStep(userId);
        return await handleWallets(ctx, userId);
      } else {
        await ctx.reply("❌ The private key or mnemonic phrase entered is incorrect.");
        return await clearUserStep(userId);
      }
    }
  }

  // 2️⃣ Only if no active step, check if input is a token CA
  const tokenTypePattern = /^0x[a-fA-F0-9]{1,64}::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/;
  if (tokenTypePattern.test(input)) {
    const user = await getUser(userId);
    const wallets = user.wallets || [];
    const validWallets = wallets.filter(w => typeof w === "object" && (w.address || w.walletAddress));

    if (validWallets.length === 0) {
      return ctx.reply("❌ You need to import or generate a wallet first.");
    }

    const firstWallet = validWallets[0]?.address || validWallets[0]?.walletAddress;
    const steps = {
      state: "awaiting_buy_token_address",
      currentWallet: firstWallet,
      currentFlow: "standard",
      selectedWallets: firstWallet ? [firstWallet] : [],
      wallets: validWallets.map(w => w.address || w.walletAddress),
      showAllWallets: false,
      buySlippage: Number.isFinite(validWallets[0]?.buySlippage) ? validWallets[0].buySlippage : 1,
      sellSlippage: validWallets[0]?.sellSlippage ?? 1,
      mode: "buy",
      mainMessageId: ctx.message.message_id,
    };

    await saveUserStep(userId, steps);
    return await handleBuyTokenAddressFlow(ctx, steps);
  }

  // 3️⃣ Fallback: generic action or error
  return ctx.reply("🤖 I didn’t understand that. Please use the menu or type /start.");
});


// bot.on("message", async (ctx, next) => {
//   const userId = ctx.from.id;
//   const chatId = ctx.chat.id;
//   const text = ctx.message.text?.trim();
//   const replyTo = ctx.message?.reply_to_message?.text;
//   const step = await fetchUserStep(userId);


//   if (!text) return;
//   const input = text.trim();

//   // const tokenTypePattern = /^0x[a-fA-F0-9]{1,64}::[a-zA-Z0-9_]{1,}::[a-zA-Z0-9_]{1,}$/;
//   const tokenTypePattern = /^0x[a-fA-F0-9]{1,64}::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/;

//   if (tokenTypePattern.test(input)) {
//     const user = await getUser(userId);
//     const wallets = user.wallets || [];
//     const validWallets = wallets.filter(
//       w => typeof w === 'object' && (w.address || w.walletAddress)
//     );
//     if (validWallets.length === 0) {
//       return ctx.reply("❌ You need to import or generate a wallet first.");
//     }
//     const firstWallet = validWallets[0]?.address || validWallets[0]?.walletAddress;
//     const steps = {
//       state: "awaiting_buy_token_address",
//       currentWallet: firstWallet,
//       currentFlow: "standard",
//       selectedWallets: firstWallet ? [firstWallet] : [],
//       wallets: validWallets.map(w => w.address || w.walletAddress),
//       showAllWallets: false,
//       buySlippage: Number.isFinite(validWallets[0]?.buySlippage) ? validWallets[0].buySlippage : 1,
//       sellSlippage: validWallets[0]?.sellSlippage ?? 1,
//       mode: "buy",
//       mainMessageId: ctx.message.message_id,
//     };
//     await saveUserStep(userId, steps);
//     await handleBuyTokenAddressFlow(ctx, steps);
//     return;
//   }


//   if (step?.state === "confirming_seed_phrase") {
//     const userInput = ctx.message.text.trim();
//     const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
//     const decryptedSeed = decryptWallet(step.expectedSeed, ENCRYPTION_SECRET);
//     const decryptedPK = decryptWallet(step.expectedPrivateKey, ENCRYPTION_SECRET);
//     const seedMatch = normalize(userInput) === normalize(decryptedSeed);
//     const pkMatch = userInput === decryptedPK;

//     if (seedMatch || pkMatch) {
//       await ctx.reply("✅ Wallet connected successfully!");
//       await clearUserStep(userId);
//       await handleWallets(ctx, userId);
//     } else {
//       await ctx.reply("❌ The private key or mnemonic phrase entered is incorrect.");
//       await clearUserStep(userId);
//     }
//     return;
//   }

//   // Connecting Wallet
//   if (step?.state === "awaiting_wallet_input") {
//     const walletImportHandled = await handleWalletImport(ctx, userId);
//     if (walletImportHandled) return;
//   }

//   // Wallet generation
//   if (step?.state === "awaiting_wallet_generation_count" && step?.flow === "generate_wallets") {
//     await handleWalletGenerationRequest(ctx, userId);
//     return;
//   }

//   // withdraw tokens: step 1
//   if (step?.name === "withdraw_token_amount") {
//     await handleWithdrawTokenAddress(ctx, step, text);
//     return;
//   }

//   //withdraw tokens: step 2
//   if (step?.name === "withdraw_token_address") {
//     await handleExecuteTokenWithdraw(ctx, step, text);
//     step.name = null;
//     await saveUserStep(userId, step);
//     // return;
//   }

//   if (step?.action === "renaming_wallet") {
//     await handleRenameWallet(ctx);
//     return;
//   }

//   // slippage
//   if (step?.state === "awaiting_slippage_input") {
//     await handleSlippageInput(ctx, step, userId, text);
//     return;
//   }

//   // Withdraw SUI: step 1 (recipient)
//   if (step?.action === "awaiting_withdraw_sui_address") {
//     await handleWithdrawAddressInput(ctx, step);
//     return;
//   }

//   // Withdraw SUI: step 2 (amount)
//   if (step?.action === "awaiting_withdraw_amount") {
//     await handleWithdrawAmountInput(ctx, step);
//     return;
//   }

//   // Limit order trigger value
//   if (step?.state === "awaiting_limit_trigger_value") {
//     await handleLimitTriggerValueInput(ctx, step);
//     return;
//   }

//   if (step?.state === "awaiting_dca_duration" || step?.state === "awaiting_dca_interval") {
//     return await handleDcaInput(ctx, step);
//   }

//   // Buy token flow
//   if (step?.state === "awaiting_buy_token_address") {
//     try {
//       await handleBuyTokenAddressFlow(ctx, step);
//     } catch (err) {
//       console.error("❌ Error in handleBuyTokenAddressFlow:", err);
//     }
//     return;
//   }


//   // Sell token flow
//   if (step?.state === "awaiting_sell_token_address") {
//     await handleSellTokenAddressFlow(ctx, step);
//     return;
//   }

//   // Buy or Sell with custom input amount
//   if (
//     step?.state === 'awaiting_custom_buy_amount' ||
//     step?.state === 'awaiting_custom_sell_amount'
//   ) {
//     await handleCustomAmountInput(ctx, step, userId);
//     return;
//   }

//   // Final fallback: generic action handler
//   const isFreeTextReply =
//     !step?.awaitingSlippageInput &&
//     step?.state &&
//     step?.state === "awaiting_wallet_input" &&
//     step?.state === "awaiting_wallet_generation_count" &&
//     step?.state !== "awaiting_buy_token_address" &&
//     step?.state !== "awaiting_sell_token_address" &&
//     step?.action !== "awaiting_withdraw_sui_address" &&
//     step?.action !== "awaiting_withdraw_amount" &&
//     step?.name !== "withdraw_token_amount" &&
//     step?.name !== "withdraw_token_address" &&
//     !(replyTo?.includes("mnemonic") || replyTo?.includes("privatekey")) &&
//     !(replyTo?.includes("How many wallets would you like to generate")) &&
//     step?.state !== 'awaiting_custom_buy_amount' &&
//     step?.state !== 'confirming_seed_phrase' &&
//     step?.state !== 'awaiting_custom_sell_amount';

//   if (isFreeTextReply && text) {
//     return await handleAction(ctx, text, userId);
//   }

//   if (!ctx.message?.reply_to_message && !step) {
//     return ctx.reply("🤖 I didn’t understand that. Please use the menu or type /start.");
//   }

// });

bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  try {
    await ctx.answerCbQuery();
  } catch (e) {
    console.warn("Failed to answer callback query:", e.message);
  }
  try {
    await handleAction(ctx, data, userId);
  } catch (err) {
    console.error("Error in handle action", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
});

export default { bot, webhookCallback: bot.webhookCallback('/'), };