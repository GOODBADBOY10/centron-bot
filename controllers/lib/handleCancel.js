import { clearUserStep, fetchUserStep } from "./db.js";
import { mainMenu } from "./mainMenu.js";

export async function handleCancel(ctx, userId) {
    try {
        // // (optional) fetch current step if you want to clean up old message
        // const step = await fetchUserStep(userId);

        // if (step?.mainMessageId) {
        //     try {
        //         await ctx.deleteMessage(step.mainMessageId);
        //     } catch (err) {
        //         console.log("⚠️ Could not delete old message:", err.message);
        //     }
        // }
        // clear step from DB
        await clearUserStep(userId);

        // return them to main menu
        await ctx.reply("❌ Cancelled. Back at main menu.", mainMenu);
    } catch (err) {
        console.error(`❌ Failed to cancel for user ${userId}:`, err);
        await ctx.reply("⚠️ Something went wrong while cancelling. Try again.");
    }
}