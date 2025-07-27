import { fetchUser, updateUser, saveUserStep } from './db.js';

export async function handleBuySlippage(ctx, userId, step = null) {
    const user = await fetchUser(userId);
    const wallets = user?.wallets || [];

    if (wallets.length === 0) {
        return ctx.reply("😕 No wallets found.");
    }
    const buttons = [];
    buttons.push([{ text: `✅ All Wallets | ${user.buySlippage || "1.0"}%`, callback_data: `set_buy_slippage_all` }]);
    wallets.forEach((wallet, index) => {
        if (!wallet.walletAddress) return;
        const short = `${wallet.walletAddress.slice(0, 4)}...${wallet.walletAddress.slice(-4)}`;
        const displayName = wallet.name || short;

        buttons.push([{
            text: `${displayName} | ${wallet.buySlippage || "1.0"}%`,
            callback_data: `set_buy_slippage_${index}`
        }]);
    });
    const returnTo = step?.returnTo || "main_menu";
    buttons.push([{ text: "← Back", callback_data: `back_to_${returnTo}` }]);
    const messageText = `Click on a wallet to set buy slippage % for it:\n\n📘 [How to Use?](https://example.com/help)`;
    const options = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    try {
        if (ctx.callbackQuery?.message?.message_id) {
            await ctx.editMessageText(messageText, options);

            if (step) {
                step.mainMessageId = ctx.callbackQuery.message.message_id;
                await saveUserStep(userId, step);
            }
        } else if (step?.mainMessageId) {
            await ctx.telegram.editMessageText(ctx.chat.id, step.mainMessageId, undefined, messageText, options);
        } else {
            const sent = await ctx.reply(messageText, options);
            if (step) {
                step.mainMessageId = sent.message_id;
                await saveUserStep(userId, step);
            }
        }
    } catch (error) {
        const sent = await ctx.reply(messageText, options);
        if (step) {
            step.mainMessageId = sent.message_id;
            await saveUserStep(userId, step);
        }
    }
}


export async function handleSellSlippage(ctx, userId, step = null) {
    const user = await fetchUser(userId);
    const wallets = user?.wallets || [];

    if (wallets.length === 0) {
        return ctx.reply("😕 No wallets found.");
    }

    const buttons = [];

    buttons.push([
        {
            text: `✅ All Wallets | ${user.sellSlippage || "1.0"}%`,
            callback_data: `set_sell_slippage_all`
        }
    ]);

    wallets.forEach((wallet, index) => {
        if (!wallet.walletAddress) return;

        const short = `${wallet.walletAddress.slice(0, 4)}...${wallet.walletAddress.slice(-4)}`;
        const displayName = wallet.name || short;

        buttons.push([
            {
                text: `${displayName} | ${wallet.sellSlippage || "1.0"}%`,
                callback_data: `set_sell_slippage_${index}`
            }
        ]);
    });

    const returnTo = step?.returnTo || "main_menu";
    buttons.push([
        { text: "← Back", callback_data: `back_to_${returnTo}` }
    ]);

    const messageText = `Click on a wallet to set sell slippage % for it:\n\n📘 [How to Use?](https://example.com/help)`;

    const options = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };

    try {
        if (ctx.callbackQuery?.message?.message_id) {
            await ctx.editMessageText(messageText, options);
            if (step) {
                step.mainMessageId = ctx.callbackQuery.message.message_id;
                await saveUserStep(userId, step);
            }
        } else if (step?.mainMessageId) {
            await ctx.telegram.editMessageText(ctx.chat.id, step.mainMessageId, undefined, messageText, options);
        } else {
            const sent = await ctx.reply(messageText, options);
            if (step) {
                step.mainMessageId = sent.message_id;
                await saveUserStep(userId, step);
            }
        }
    } catch (error) {
        const sent = await ctx.reply(messageText, options);
        if (step) {
            step.mainMessageId = sent.message_id;
            await saveUserStep(userId, step);
        }
    }
}


export async function updateAllBuyWalletsSlippage(userId, slippage) {
    try {
        const user = await fetchUser(userId);
        if (!user) throw new Error("User not found");

        const updatedUser = {
            ...user,
            buySlippage: slippage,
            wallets: (user.wallets || []).map(wallet => ({
                ...wallet,
                buySlippage: slippage
            }))
        };
        await updateUser(userId, updatedUser);
    } catch (error) {
        throw error;
    }
}

export async function updateAllSellWalletsSlippage(userId, slippage) {
    try {
        const user = await fetchUser(userId);
        if (!user) throw new Error("User not found");

        const updatedUser = {
            ...user,
            sellSlippage: slippage,
            wallets: (user.wallets || []).map(wallet => ({
                ...wallet,
                sellSlippage: slippage
            }))
        };

        await updateUser(userId, updatedUser);
    } catch (error) {
        throw error;
    }
}
