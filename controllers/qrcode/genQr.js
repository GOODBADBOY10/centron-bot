import QRCode from "qrcode";

export async function generateQRCode(link) {
  return await QRCode.toBuffer(link);
}

export async function showReferralQRCode(ctx) {
  const userId = ctx.from.id.toString();
  const referralLink = `https://t.me/${ctx.me}?start=ref_${userId}`;

  const qrImageBuffer = await generateQRCode(referralLink); // your custom function
  await ctx.replyWithPhoto({ source: qrImageBuffer }, { caption: "Here's your referral QR code." });

  await ctx.answerCbQuery();
}

export async function closeMessage(ctx) {
  try {
    await ctx.deleteMessage();
  } catch (err) {
    console.error("❌ Couldn't delete message:", err.message);
  }
  await ctx.answerCbQuery("Closed.");
}
