import express from 'express';
import dotenv from 'dotenv';
import bot from './controllers/lib/bot.js';
import { getAllPendingLimitOrders } from './controllers/lib/db.js';

dotenv.config();

const app = express();
app.use(express.json());

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
    console.log(`🚀 Server running on port ${ PORT }`);
    console.log(`⚡ Setting Telegram webhook to ${ process.env.PUBLIC_URL } /`);

    if (bot && bot.telegram) {
        bot.telegram.setWebhook(`${process.env.PUBLIC_URL}/`);
    } else {
        console.error("❌ bot or bot.telegram is undefined");
    }
});


// Background polling/checking task (e.g. every 20 seconds)
setInterval(() => {
    getAllPendingLimitOrders();
}, 20 * 1000);