export async function handleConfig(ctx, userId) {
    const configMenu = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✏️ Buy Slippage", callback_data: "buy_slippage" },
                    { text: "✏️ Sell Slippage", callback_data: "sell_slippage" }
                ],
                [
                    { text: "← Main Menu", callback_data: "back_to_menu" }
                ]
            ]
        }
    };

    try {
        await ctx.editMessageText("⚙ Settings", configMenu);
    } catch (error) {
        if (error.description?.includes("message can't be edited")) {
            await ctx.reply("⚙ Settings", configMenu);
        } else {
            throw error;
        }
    }
}