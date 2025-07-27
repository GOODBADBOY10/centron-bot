import { saveUserStep } from "./db.js";

export async function handleWithdrawAddressInput(ctx, step) {
    const userId = ctx.from.id;
    const address = ctx.message.text.trim();
    await saveUserStep(userId, {
        ...step,
        action: "awaiting_withdraw_amount",
        withdrawAddress: address
    });

    return ctx.reply("Please enter the amount of SUI you want to withdraw:", {
        reply_markup: { force_reply: true }
    });
}



export async function handleWithdrawAmountInput(ctx, step) {
    const userId = ctx.from.id;
    const amount = parseFloat(ctx.message.text.trim());

    if (isNaN(amount) || amount <= 0) {
        return ctx.reply("⚠️ Please enter a valid amount greater than 0.");
    }
    await saveUserStep(userId, {
        ...step,
        action: "confirming_withdraw",
        amount
    });
    return ctx.reply(
        `🧾 *Confirm Withdrawal*\n\n` +
        `📤 *From:* \`${step.walletAddress}\`\n\n` +
        `📥 *To:* \`${step.withdrawAddress}\`\n\n` +
        `💸 *Amount:* ${amount} SUI\n\n` +
        `Do you want to proceed?`,
        {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Confirm", callback_data: "confirm_withdraw" },
                        { text: "❌ Cancel", callback_data: "cancel_withdraw" }
                    ]
                ]
            }
        }
    );
}