import { getUser } from "./db.js";

export async function handleReferrals(ctx, userId) {
    const user = await getUser(userId.toString());

    if (!user) {
        return ctx.reply("User not found. Please start with /start.");
    }

    const referralLink = `https://t.me/${ctx.me}?start=ref_${userId}`;
    const referralCount = user.referredCount || 0;
    const referralEarnings = user.referralEarnings || 0;
    let message = '';
    message += `Your Reflink: ${referralLink}\n\n`;
    message += `Referrals: <b>${referralCount} </b>\n\n`;
    message += `Lifetime SUI earned: <b>${referralEarnings.toFixed(2)}</b> SUI\n\n`;
    message += `Rewards are updated at least once every 24 hours and are automatically credited to your SUI balance.\n\n`;
    message += `Refer your friends and earn 20% of their fees in the first month, 10% in the second and 5% <b>forever!</b>\n`;
    await ctx.replyWithHTML(message, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "QR Code", callback_data: "show_qr" },
                    { text: "← Back", callback_data: "close_msg" }
                ]
            ]
        }
    });
}