import { fetchUserStep, saveUserStep } from "../lib/db.js";
import { renderMainMessage } from "../lib/handleLimitKeyboard.js";

export async function handleBackAction(ctx) {
    const userId = ctx.from.id;
    let step = await fetchUserStep(userId);
    if (!step) step = {};

    // Exit limit order flow cleanly
    delete step.isInLimitFlow;
    delete step.limitTriggerValue;
    
    // Exit DCA flow cleanly
    delete step.dcaDuration;
    delete step.dcaInterval;
    delete step.dcaDurationMinutes;
    delete step.dcaIntervalMinutes;
    step.currentFlow = null;
    // step.showAllWallets = false; // optional reset

    // ✅ DO NOT delete tokenInfo or mode — required for re-render
    await saveUserStep(userId, step);

    // Re-render token info view with full keyboard and balances
    await renderMainMessage(ctx, userId);

    return ctx.answerCbQuery("🔙 Back to token info");
}