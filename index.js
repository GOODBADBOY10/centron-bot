import express from 'express';
import dotenv from 'dotenv';
import ngrok from 'ngrok';
import bot from './controllers/lib/bot.js';
import { getAllPendingLimitOrders } from './controllers/lib/db.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080

app.listen(PORT, async (err) => {
    if (err) {
        return;
    }
    try {
        const url = await ngrok.connect({
            addr: PORT,
        });
        if (bot && bot.telegram) {
            await bot.telegram.setWebhook(`${url}/`);
        } else {
            console.error("⚠️ bot or bot.telegram is undefined");
        }
    } catch (e) {
        console.error("🔥 Error starting ngrok or setting webhook:");
    }
});

setInterval(() => {
    getAllPendingLimitOrders()
}, 20 * 1000);