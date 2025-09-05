import { updateDcaOrderExecution, getUser } from "../lib/db.js";
import { markDcaOrderAsCompleted } from "../lib/db.js";
import { getAllPendingDcaOrders } from "../lib/db.js";
import { buyTokenWithAftermath, sellTokenWithAftermath } from "../aftermath/aftermath.js"
import { bot } from "../lib/bot.js"

export async function checkPendingDcaOrders() {
    const orders = await getAllPendingDcaOrders(); // Only active orders

    for (const order of orders) {
        try {
            const now = Date.now();
            const lastTime = order.lastExecuted || 0;
            const intervalMs = order.intervalMinutes * 60 * 1000;

            // Check if it's time to execute
            if (now - lastTime < intervalMs) {
                continue; // Not yet time
            }

            const user = await getUser(order.userId);
            const wallet = user.wallets?.find(w => w.address?.toLowerCase() === order.walletAddress?.toLowerCase());
            const phrase = wallet?.seedPhrase || wallet?.privateKey;

            if (!phrase) {
                console.warn(`⚠️ Missing phrase for wallet ${order.walletAddress}`);
                continue;
            }

            // Perform the DCA order
            // After executing the buy/sell
            let tx;
            if (order.mode === "buy") {
                tx = await buyTokenWithAftermath({
                    tokenAddress: order.tokenAddress,
                    phrase,
                    suiAmount: order.suiAmount,
                    slippage: order.slippage
                });
            } else {
                tx = await sellTokenWithAftermath({
                    tokenAddress: order.tokenAddress,
                    phrase,
                    suiPercentage: order.suiPercentage,
                    slippage: order.slippage
                });
            }

            // Update order: increment execution count & lastExecuted
            await updateDcaOrderExecution(order.id, {
                lastExecuted: now,
                executedCount: (order.executedCount || 0) + 1
            });

            const shortWallet = `${tx.walletAddress.slice(0, 6)}...${tx.walletAddress.slice(-4)}`;
            const explorerUrl = `https://suiscan.xyz/mainnet/tx/${tx.transactionDigest}`;
            const formatNum = (num) => (typeof num === "number" ? num.toFixed(5) : "0");
            let messageText;
            if (order.mode === "buy") {
                messageText =
                    `${shortWallet} [DCA] ✅ Swapped ${formatNum(tx.spentSUI)} SUI ↔ ${formatNum(tx.tokenAmountReadable)} $${tx.tokenSymbol}\n` +
                    `🔗 <a href="${explorerUrl}">View Transaction Record on Explore</a>`;
            } else {
                messageText =
                    `${shortWallet} [DCA] ✅ Swapped ${formatNum(tx.tokenAmountSold)} $${tx.tokenSymbol} ↔ ${formatNum(tx.suiAfterFee)} SUI\n` +
                    `🔗 <a href="${explorerUrl}">View Transaction Record on Explore</a>`;
            }

            await bot.telegram.sendMessage(order.userId, messageText, {
                parse_mode: "HTML",
                disable_web_page_preview: true
            });

            // If there's a max execution count, check if we should stop
            const newExecutedCount = (order.executedCount || 0) + 1;

            await updateDcaOrderExecution(order.id, {
                lastExecuted: now,
                executedCount: newExecutedCount,
            });

            if (order.maxExecutions && newExecutedCount >= order.maxExecutions) {
                await markDcaOrderAsCompleted(order.id);
                await bot.telegram.sendMessage(
                    order.userId,
                    `✅ DCA order completed (executed ${order.maxExecutions} times)`
                );
            }

        } catch (err) {
            console.error(`❌ Error processing DCA order ${order.id}:`, err);
        }
    }
}