import { handleBuySlippage, handleSellSlippage } from "../lib/buySlippage.js";
import { getUser, saveUserStep } from "../lib/db.js";
import { shortAddress } from "../lib/shortAddress.js";

export async function startBuySlippageFlow(ctx) {
    const userId = ctx.from.id;
    const step = {
        state: "setting_buy_slippage",
        returnTo: "config",
    };

    await saveUserStep(userId, step);
    await handleBuySlippage(ctx, userId, step);
}

export async function promptBuySlippageForWallet(ctx, index) {
    const userId = ctx.from.id;
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
}

export async function promptBuySlippageAll(ctx) {
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
}

export async function startSellSlippageFlow(ctx) {
    const userId = ctx.from.id;
    const step = {
        state: "setting_sell_slippage",
        returnTo: "config",
    };

    await saveUserStep(userId, step);
    await handleSellSlippage(ctx, userId, step);
}

export async function promptSellSlippageAll(ctx) {
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
}

export async function promptSellSlippageForWallet(ctx, index) {
    const userId = ctx.from.id;
    const user = await getUser(userId);
    const wallet = user.wallets?.[index];

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
}



