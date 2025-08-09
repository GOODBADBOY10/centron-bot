import { Telegraf } from "telegraf";
import { session } from 'telegraf';
import { handleAction } from "./handleAction.js";
import { handleWallets } from "./handleWallets.js";
import { fetchUserStep, getUser } from "./db.js";
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

function normalize(seed) {
  return seed
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

bot.on("message", async (ctx, next) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text?.trim();
  const replyTo = ctx.message?.reply_to_message?.text;
  const step = await fetchUserStep(userId);


  if (!text) return;
  const input = text.trim();

  // const tokenTypePattern = /^0x[a-fA-F0-9]{1,64}::[a-zA-Z0-9_]{1,}::[a-zA-Z0-9_]{1,}$/;
  const tokenTypePattern = /^0x[a-fA-F0-9]{1,64}::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/;

  if (tokenTypePattern.test(input)) {
    const user = await getUser(userId);
    const wallets = user.wallets || [];
    const validWallets = wallets.filter(
      w => typeof w === 'object' && (w.address || w.walletAddress)
    );
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
    await handleBuyTokenAddressFlow(ctx, steps);
    return;
  }


  if (step?.state === "confirming_seed_phrase") {
    const userInput = ctx.message.text.trim();
    const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
    const decryptedSeed = decryptWallet(step.expectedSeed, ENCRYPTION_SECRET);
    const decryptedPK = decryptWallet(step.expectedPrivateKey, ENCRYPTION_SECRET);
    const seedMatch = normalize(userInput) === normalize(decryptedSeed);
    const pkMatch = userInput === decryptedPK;

    if (seedMatch || pkMatch) {
      await ctx.reply("✅ Wallet connected successfully!");
      await clearUserStep(userId);
      await handleWallets(ctx, userId);
    } else {
      await ctx.reply("❌ The private key or mnemonic phrase entered is incorrect.");
      await clearUserStep(userId);
    }
    return;
  }

  // Connecting Wallet
  if (step?.state === "awaiting_wallet_input") {
    const walletImportHandled = await handleWalletImport(ctx, userId);
    if (walletImportHandled) return;
  }

  // Wallet generation
  if (step?.state === "awaiting_wallet_generation_count" && step?.flow === "generate_wallets") {
    await handleWalletGenerationRequest(ctx, userId);
    return;
  }

  // withdraw tokens: step 1
  if (step?.name === "withdraw_token_amount") {
    await handleWithdrawTokenAddress(ctx, step, text);
    return;
  }

  //withdraw tokens: step 2
  if (step?.name === "withdraw_token_address") {
    await handleExecuteTokenWithdraw(ctx, step, text);
    step.name = null;
    await saveUserStep(userId, step);
    // return;
  }

  if (step?.action === "renaming_wallet") {
    await handleRenameWallet(ctx);
    return;
  }

  // slippage
  if (step?.state === "awaiting_slippage_input") {
    await handleSlippageInput(ctx, step, userId, text);
    return;
  }

  // Limit order trigger value
  if (step?.state === "awaiting_limit_trigger_value") {
    await handleLimitTriggerValueInput(ctx, step);
    return;
  }

  if (step?.state === "awaiting_dca_duration" || step?.state === "awaiting_dca_interval") {
    return await handleDcaInput(ctx, step);
  }

  // Buy token flow
  if (step?.state === "awaiting_buy_token_address") {
    try {
      await handleBuyTokenAddressFlow(ctx, step);
    } catch (err) {
      console.error("❌ Error in handleBuyTokenAddressFlow:", err);
    }
    return;
  }


  // Sell token flow
  if (step?.state === "awaiting_sell_token_address") {
    await handleSellTokenAddressFlow(ctx, step);
    return;
  }

  // Buy or Sell with custom input amount
  if (
    step?.state === 'awaiting_custom_buy_amount' ||
    step?.state === 'awaiting_custom_sell_amount'
  ) {
    await handleCustomAmountInput(ctx, step, userId);
    return;
  }

  // Withdraw SUI: step 1 (recipient)
  if (step?.action === "awaiting_withdraw_sui_address") {
    await handleWithdrawAddressInput(ctx, step);
    return;
  }

  // Withdraw SUI: step 2 (amount)
  if (step?.action === "awaiting_withdraw_amount") {
    await handleWithdrawAmountInput(ctx, step);
    return;
  }

  // Final fallback: generic action handler
  const isFreeTextReply =
    !step?.awaitingSlippageInput &&
    step?.state &&
    step?.state === "awaiting_wallet_input" &&
    step?.state === "awaiting_wallet_generation_count" &&
    step?.state !== "awaiting_buy_token_address" &&
    step?.state !== "awaiting_sell_token_address" &&
    step?.state !== "awaiting_withdraw_sui_address" &&
    step?.state !== "awaiting_withdraw_amount" &&
    step?.name !== "withdraw_token_amount" &&
    step?.name !== "withdraw_token_address" &&
    !(replyTo?.includes("mnemonic") || replyTo?.includes("privatekey")) &&
    !(replyTo?.includes("How many wallets would you like to generate")) &&
    step?.state !== 'awaiting_custom_buy_amount' &&
    step?.state !== 'confirming_seed_phrase' &&
    step?.state !== 'awaiting_custom_sell_amount';

  if (isFreeTextReply && text) {
    return await handleAction(ctx, text, userId);
  }

  if (!ctx.message?.reply_to_message && !step) {
    return ctx.reply("🤖 I didn’t understand that. Please use the menu or type /start.");
  }

});

bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  try {
    await ctx.answerCbQuery();
  } catch (e) {
    console.warn("⚠️ Failed to answer callback query:", e.message);
  }
  try {
    await handleAction(ctx, data, userId);
  } catch (err) {
    await ctx.reply("Something went wrong. Please try again.");
  }
});

export default { bot, webhookCallback: bot.webhookCallback('/'), };