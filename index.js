import express from 'express';
import dotenv from 'dotenv';
import botModule from './controllers/lib/bot.js';
import { checkPendingDcaOrders } from './controllers/dca/dca.js';
import { checkPendingMcapOrders } from './controllers/mcap/mcap.js'
dotenv.config();

const { bot, webhookCallback } = botModule;

const app = express();
app.use(express.json());
app.post('/', webhookCallback);


app.get("/", (req, res) => {
    res.send("🤖 Telegram bot is live!");
});

// Your Telegram bot webhook handler
app.post('/', (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`⚡ Setting Telegram webhook to ${process.env.PUBLIC_URL} /`);

    void (async () => {
        if (bot && bot.telegram) {
            try {
                await bot.telegram.setWebhook(`${process.env.PUBLIC_URL}/`);
                console.log("✅ Webhook set successfully.");
            } catch (err) {
                console.error("❌ Failed to set webhook:", err.message);
            }
        } else {
            console.error("❌ bot or bot.telegram is undefined");
        }
    })();
});


// Background polling/checking task (e.g. every 20 seconds)
setInterval(() => {
    try {
        checkPendingMcapOrders();
    } catch (err) {
        console.error("Error in checkPendingMcapOrders:", err);
    }
}, 20 * 1000);


setInterval(() => {
    try {
        checkPendingDcaOrders()
    } catch (err) {
        console.error("Error in runDcaOrdersLoop:", err);
    }
}, 60 * 1000);