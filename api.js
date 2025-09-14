const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// Kết nối với MongoDB
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    throw new Error('Error: MONGO_URI environment variable not found.');
}

const connectDB = async () => {
    if (mongoose.connections[0].readyState) return;
    try {
        await mongoose.connect(mongoUri);
        console.log("Successfully connected to MongoDB!");
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw new Error("Could not connect to the database.");
    }
};

// Định nghĩa các Schema
const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    isBotEnabled: { type: Boolean, default: true },
});

const appSchema = new mongoose.Schema({
    appId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    name: { type: String, required: true },
});

const keySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    appId: { type: String, required: true },
    status: { type: String, enum: ['unused', 'used', 'expired'], default: 'unused' },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    userDiscordId: { type: String, default: null },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const App = mongoose.models.App || mongoose.model('App', appSchema);
const Key = mongoose.models.Key || mongoose.model('Key', keySchema);

// Endpoint chính để xử lý tất cả các yêu cầu
app.all('/api', async (req, res) => {
    try {
        await connectDB();
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Database connection error.' });
    }

    const { action, payload } = req.body;
    
    // Kiểm tra quyền truy cập, trừ các lệnh cho phép người dùng
    if (action !== 'enable' && action !== 'disable') {
        const user = await User.findOne({ discordId: payload.requesterId });
        if (!user || !user.isBotEnabled) {
            return res.status(403).json({ success: false, message: 'You do not have permission to use this bot.' });
        }
    }

    try {
        let result;
        switch (action) {
            case 'createkey':
            case 'gen': {
                const { appId, duration } = payload;
                const quantity = 1;
                const appExists = await App.findOne({ appId });
                if (!appExists) {
                    return res.status(404).json({ success: false, message: 'Application does not exist.' });
                }

                const expiresAt = duration ? new Date(Date.now() + duration * 1000 * 60 * 60 * 24) : null;
                const randomKey = crypto.randomBytes(8).toString('hex').toUpperCase();
                const newKey = new Key({ key: randomKey, appId, expiresAt });
                await newKey.save();

                result = { success: true, message: `Successfully created key.`, keys: [newKey.key] };
                break;
            }

            case 'bulkgen':
            case 'bulkcreatekey': {
                const { appId, quantity, duration } = payload;
                const appExists = await App.findOne({ appId });
                if (!appExists) {
                    return res.status(404).json({ success: false, message: 'Application does not exist.' });
                }

                const keys = [];
                const expiresAt = duration ? new Date(Date.now() + duration * 1000 * 60 * 60 * 24) : null;
                for (let i = 0; i < quantity; i++) {
                    const randomKey = crypto.randomBytes(8).toString('hex').toUpperCase();
                    keys.push({ key: randomKey, appId, expiresAt });
                }

                await Key.insertMany(keys);
                result = { success: true, message: `Successfully created ${quantity} keys.`, keys: keys.map(k => k.key) };
                break;
            }

            case 'checkkey': {
                const { key } = payload;
                const keyData = await Key.findOne({ key });
                if (!keyData) {
                    return res.status(404).json({ success: false, message: 'Key does not exist.' });
                }
                result = { success: true, keyData };
                break;
            }

            case 'deleteexpiredkeys':
            case 'deleteexpired': {
                const { appId } = payload;
                const resultDB = await Key.deleteMany({ appId, expiresAt: { $lt: new Date() } });
                result = { success: true, message: `Successfully deleted ${resultDB.deletedCount} expired keys.` };
                break;
            }

            case 'deletekey': {
                const { key } = payload;
                const resultDB = await Key.deleteOne({ key });
                if (resultDB.deletedCount === 0) {
                    return res.status(404).json({ success: false, message: 'Key does not exist.' });
                }
                result = { success: true, message: 'Key successfully deleted.' };
                break;
            }

            case 'allkeys': {
                const { appId } = payload;
                const keys = await Key.find({ appId });
                result = { success: true, keys };
                break;
            }

            case 'stats': {
                const { appId } = payload;
                const totalKeys = await Key.countDocuments({ appId });
                const unusedKeys = await Key.countDocuments({ appId, status: 'unused' });
                const usedKeys = await Key.countDocuments({ appId, status: 'used' });
                result = { success: true, stats: { totalKeys, unusedKeys, usedKeys } };
                break;
            }

            case 'enable': {
                const { targetId } = payload;
                const resultDB = await User.findOneAndUpdate(
                    { discordId: targetId },
                    { isBotEnabled: true },
                    { new: true, upsert: true }
                );
                result = { success: true, message: `Successfully enabled user <@${targetId}>.` };
                break;
            }
            
            case 'disable': {
                const { targetId } = payload;
                const resultDB = await User.findOneAndUpdate(
                    { discordId: targetId },
                    { isBotEnabled: false },
                    { new: true, upsert: true }
                );
                result = { success: true, message: `Successfully disabled user <@${targetId}>.` };
                break;
            }

            default:
                result = { success: false, message: 'Invalid command.' };
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, message: 'Server error occurred.' });
    }
});

module.exports = app;
