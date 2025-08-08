import admin from "firebase-admin";
import dotenv from "dotenv";
dotenv.config();

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Save/update user in Firestore
export async function saveUser(userId, data) {
    const userRef = db.collection('users').doc(userId.toString());
    await userRef.set(data, { merge: true });
}

export async function updateUser(userId, updatedUserData) {
    const userRef = db.collection('users').doc(userId.toString());
    await userRef.set(updatedUserData, { merge: true });
}

// fetch user
export async function fetchUser(userId) {
    const userRef = db.collection('users').doc(userId.toString());
    const doc = await userRef.get();

    return doc.exists ? doc.data() : null;
}

// // Get user from Firestore
export async function getUser(userId, referrerCode) {
    let user = await fetchUser(userId);
    if (!user) {
        const referral = referrerCode ? referrerCode.replace('ref_', '') : null;
        await saveUser(userId, {
            referralCode: `ref_${userId}`,
            referredBy: referral || null,
            referrals: 0,
            step: {
                tokenAddress: "0x123...::TOKEN::ABC",
                tokenSymbol: "ABC"
            },
            firstVisit: Date.now()
        });

        user = await fetchUser(userId);
    }
    return user;
}

//usersteps
export async function saveUserStep(userId, stepData) {
    const userRef = db.collection('users').doc(userId.toString());
    await userRef.set({ step: stepData }, { merge: true });
}

//fetch user steps
export async function fetchUserStep(userId) {
    const userRef = db.collection('users').doc(userId.toString());
    const doc = await userRef.get();
    if (!doc.exists) return null;
    const userData = doc.data();
    return userData.step || null;
}

export async function clearUserStep(userId) {
    try {
        const userRef = db.collection('users').doc(userId.toString());
        await userRef.update({
            step: admin.firestore.FieldValue.delete()
        });
    } catch (err) {
        console.error(`❌ Failed to clear step for user ${userId}:`, err);
    }
}

//update steps
export async function updateUserStep(userId, newStepData) {
    const userRef = db.collection('users').doc(userId.toString());
    await userRef.update({ step: newStepData });
}

//delete user steps
export async function deleteUserStep(userId) {
    try {
        await db.collection("steps").doc(userId.toString()).delete();
    } catch (error) {
        console.error(`❌ Failed to delete step for user ${userId}:`, error);
    }
}

export async function getUserWallets(userId) {
    const user = await fetchUser(userId);
    return user?.wallets || [];
}

export async function incrementReferrer(referrerCode) {
    if (!referrerCode) return;

    const referrerId = referrerCode.replace('ref_', '');
    const userRef = db.collection('users').doc(referrerId);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) return;

            const current = doc.data().referrals || 0;
            t.update(userRef, { referrals: current + 1 });
        });
    } catch (e) {
        console.error(`Error incrementing referrals for ${referrerId}:`, e);
    }
}

export async function addWalletToUser(userId, wallet) {
    const db = admin.firestore();
    userId = String(userId);
    if (!userId || typeof userId !== "string" || userId.trim() === "") {
        throw new Error("Invalid userId: must be a non-empty string");
    }

    const cleanWallet = {};
    for (const key in wallet) {
        if (wallet[key] !== undefined) {
            cleanWallet[key] = wallet[key];
        }
    }

    // Convert privateKey to Base64 string if it's not already
    if (cleanWallet.privateKey) {
        if (cleanWallet.privateKey instanceof Uint8Array || Buffer.isBuffer(cleanWallet.privateKey)) {
            cleanWallet.privateKey = Buffer.from(cleanWallet.privateKey).toString("hex");
        } else if (typeof cleanWallet.privateKey === "object") {
            // Convert object to string representation (if it's JSON serializable)
            cleanWallet.privateKey = JSON.stringify(cleanWallet.privateKey);
        } else if (typeof cleanWallet.privateKey !== "string") {
            throw new Error("❌ privateKey must be a string, Buffer, or Uint8Array");
        }
    }

    if (!cleanWallet.walletAddress && cleanWallet.address) {
        cleanWallet.walletAddress = cleanWallet.address;
    }

    if (!cleanWallet.walletAddress) {
        throw new Error("❌ Wallet is missing a walletAddress.");
    }

    if (!cleanWallet.seedPhrase && !cleanWallet.privateKey) {
        throw new Error("❌ Wallet must have either a seed phrase or a private key.");
    }

    try {
        const userDocRef = db.collection("users").doc(userId);
        const userDoc = await userDocRef.get();

        if (userDoc.exists) {
            const userData = userDoc.data();
            const wallets = userData?.wallets || [];

            // ✅ Check if wallet already exists
            const exists = wallets.some(w => w.walletAddress === cleanWallet.walletAddress);
            if (exists) {
                throw new Error("❌ This wallet is already imported.");
            }
        }

        const dataToSave = {
            wallets: admin.firestore.FieldValue.arrayUnion(cleanWallet),
            walletAddress: cleanWallet.walletAddress // optional main walletAddress field
        };
        await userDocRef.set(dataToSave, { merge: true });
    } catch (error) {
        console.error("❌ Error saving wallet to Firestore:", error.message || error);
    }
}

export async function getPrivateKey(userId, walletAddress) {
    if (!userId || !walletAddress) {
        throw new Error(`Invalid input: userId=${userId}, walletAddress=${walletAddress}`);
    }

    const userRef = admin.firestore().collection('users').doc(userId.toString());
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        throw new Error(`User ${userId} not found.`);
    }

    const userData = userSnap.data();

    const wallet = (userData.wallets || []).find(w => w.walletAddress === walletAddress);

    if (!wallet) {
        throw new Error(`Wallet ${walletAddress} not found for user ${telegramUserId}.`);
    }

    if (!wallet.privateKey) {
        throw new Error(`Private key missing for wallet ${walletAddress}.`);
    }

    return wallet.privateKey;
}

export async function getSeedPhrase(userId, walletAddress) {
    if (!userId || !walletAddress) {
        throw new Error(`Invalid input: userId=${userId}, walletAddress=${walletAddress}`);
    }

    const userRef = admin.firestore().collection('users').doc(userId.toString());
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        throw new Error(`User ${userId} not found.`);
    }

    const userData = userSnap.data();

    const wallet = (userData.wallets || []).find(w => w.seedPhrase === walletAddress);

    if (!wallet) {
        throw new Error(`Wallet ${walletAddress} not found for user ${userId}.`);
    }

    if (!wallet.seedPhrase) {
        throw new Error(`Private key missing for wallet ${walletAddress}.`);
    }

    return wallet.seedPhrase;
}

export async function setBuySlippage(userId, slippage, target) {
    const user = await fetchUser(userId);
    if (!user || !user.wallets) return;

    if (target === "all") {
        // Update all
        user.buyAllSlippage = slippage;
        user.wallets = user.wallets.map(w => ({ ...w, buySlippage: slippage }));
    } else if (typeof target === "number" && user.wallets[target]) {
        user.wallets[target].buySlippage = slippage;
    }

    await updateBuySlippage(userId, user); // update DB
}

export async function updateBuySlippage(userId, target, slippage) {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        throw new Error(`User with ID ${userId} not found`);
    }

    const userData = userSnap.data();

    if (target === "all") {
        // Update all wallet slippage and buyAllSlippage
        const updatedWallets = (userData.wallets || []).map(wallet => ({
            ...wallet,
            buySlippage: slippage,
        }));

        await userRef.update({
            buyAllSlippage: slippage,
            wallets: updatedWallets,
        });
    } else if (typeof target === "number") {
        // Update only one wallet by index
        const wallets = [...(userData.wallets || [])];
        if (!wallets[target]) {
            throw new Error(`Wallet at index ${target} not found`);
        }

        wallets[target].buySlippage = slippage;

        await userRef.update({ wallets });
    } else {
        throw new Error(`Invalid target: ${target}`);
    }
}

export async function setSellSlippage(userId, slippage, target) {
    const user = await fetchUser(userId);
    if (!user || !user.wallets) return;

    if (target === "all") {
        // Update all
        user.sellAllSlippage = slippage;
        user.wallets = user.wallets.map(w => ({ ...w, sellSlippage: slippage }));
    } else if (typeof target === "number" && user.wallets[target]) {
        user.wallets[target].sellSlippage = slippage;
    }

    await updateSellSlippage(userId, user); // update DB
}

export async function updateSellSlippage(userId, target, slippage) {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        throw new Error(`User with ID ${userId} not found`);
    }

    const userData = userSnap.data();

    if (target === "all") {
        // Update all wallet slippage and buyAllSlippage
        const updatedWallets = (userData.wallets || []).map(wallet => ({
            ...wallet,
            sellSlippage: slippage,
        }));

        await userRef.update({
            sellAllSlippage: slippage,
            wallets: updatedWallets,
        });
    } else if (typeof target === "number") {
        // Update only one wallet by index
        const wallets = [...(userData.wallets || [])];
        if (!wallets[target]) {
            throw new Error(`Wallet at index ${target} not found`);
        }

        wallets[target].sellSlippage = slippage;

        await userRef.update({ wallets });
    } else {
        throw new Error(`Invalid target: ${target}`);
    }
}

export async function deleteUser(userId) {
    await db.collection("users").doc(userId.toString()).delete();
}

export async function updateWalletBalance(userId, walletAddress, newBalance) {
    const userRef = db.collection("users").doc(userId);
    const docSnap = await userRef.get();

    if (!docSnap.exists) return;

    const userData = docSnap.data();
    const updatedWallets = (userData.wallets || []).map(wallet =>
        wallet.address === walletAddress
            ? { ...wallet, balance: newBalance }
            : wallet
    );

    await userRef.update({ wallets: updatedWallets });
}

export async function getReferralStats(userId) {
    const user = await fetchUser(userId);
    if (!user) return "User not found.";

    const link = `https://t.me/YOUR_BOT_USERNAME?start=${user.referralCode}`;
    const count = user.referrals || 0;

    return `🔗 Your reflink: ${link}\n👥 Referrals: ${count}`;
}


export async function saveOrUpdatePosition(userId, walletAddress, tokenInfo) {
    const userRef = db.collection('users').doc(userId.toString());
    const userDoc = await userRef.get();

    const {
        tokenAddress,
        symbol,
        amountBought,
        amountInSUI,
        decimals = 9
    } = tokenInfo;

    const humanAmount = amountBought;
    const price = humanAmount === 0 ? 0 : amountInSUI / humanAmount;

    const newTx = {
        amount: humanAmount,
        price,
        time: Date.now()
    };

    const walletKey = walletAddress.toLowerCase();
    let positionsByWallet = {};

    if (userDoc.exists) {
        const userData = userDoc.data();
        positionsByWallet = typeof userData.positions === 'object' && !Array.isArray(userData.positions)
            ? userData.positions
            : {};
    }

    const walletPositions = positionsByWallet[walletKey] || [];
    const index = walletPositions.findIndex(p => p.tokenAddress === tokenAddress);

    if (index !== -1) {
        const existing = walletPositions[index];
        const updatedAmount = existing.totalAmount + humanAmount;
        const updatedCost = existing.totalCostSUI + amountInSUI;
        const avgPrice = updatedCost / (updatedAmount || 1);

        const updated = {
            ...existing,
            totalAmount: updatedAmount,
            totalCostSUI: updatedCost,
            avgPriceSUI: avgPrice,
            lastUpdated: Date.now(),
            txHistory: [...(existing.txHistory || []), newTx]
        };

        walletPositions[index] = updated;
    } else {
        walletPositions.push({
            tokenAddress,
            symbol,
            decimals,
            totalAmount: humanAmount,
            totalCostSUI: amountInSUI,
            avgPriceSUI: price,
            lastUpdated: Date.now(),
            txHistory: [newTx]
        });
    }

    positionsByWallet[walletKey] = walletPositions;
    await userRef.update({ positions: positionsByWallet });
}

export async function getUserPositions(userId, walletAddress) {
    const userRef = db.collection('users').doc(userId.toString());
    const userDoc = await userRef.get();
    if (!userDoc.exists) return [];

    const data = userDoc.data();
    const allPositions = data.positions || {};

    return allPositions[walletAddress.toLowerCase()] || [];
}

export async function savePendingLimitOrder(order) {
    try {
        const orderId = `${order.userId}_${Date.now()}`;
        const orderRef = db.collection('limitOrders').doc(orderId);

        const orderData = {
            userId: order.userId,
            walletAddress: order.walletAddress,
            tokenAddress: order.tokenAddress,
            mode: order.mode,
            suiAmount: order.suiAmount || null,
            suiPercentage: order.suiPercentage || null,
            triggerValue: order.triggerValue,
            slippage: order.slippage || 1,
            createdAt: new Date().toISOString(),
            status: 'pending',
        };

        Object.keys(orderData).forEach(key => {
            if (orderData[key] === undefined) {
                delete orderData[key];
            }
        });

        await orderRef.set(orderData);
    } catch (error) {
        throw error;
    }
}

export async function getAllPendingLimitOrders() {
    try {
        const snapshot = await db.collection('limitOrders')
            .where('status', '==', 'pending')
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));
    } catch (error) {
        console.error("❌ Failed to fetch pending limit orders:", error);
        return [];
    }
}

export async function markOrderAsCompleted(orderId) {
    try {
        const ref = db.collection('limitOrders').doc(orderId);
        await ref.update({ status: 'completed', completedAt: new Date().toISOString() });
    } catch (error) {
        console.error(`❌ Failed to mark order ${orderId} as completed:`, error);
    }
}