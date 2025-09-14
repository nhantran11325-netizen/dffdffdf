const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// Kết nối với MongoDB
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    throw new Error('Lỗi: Không tìm thấy biến môi trường MONGO_URI.');
}

const connectDB = async () => {
    if (mongoose.connections[0].readyState) return;
    await mongoose.connect(mongoUri);
    console.log("Đã kết nối thành công với MongoDB!");
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
    await connectDB();
    const { action, payload } = req.body;

    // Giả định có xác thực
    const user = await User.findOne({ discordId: payload.requesterId });
    if (action !== 'enable' && action !== 'disable' && (!user || !user.isBotEnabled)) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền sử dụng bot.' });
    }

    try {
        let result;
        switch (action) {
            case 'createkey':
            case 'bulkgen': {
                const { appId, quantity, duration } = payload;
                const appExists = await App.findOne({ appId });
                if (!appExists) {
                    return res.status(404).json({ success: false, message: 'Ứng dụng không tồn tại.' });
                }

                const keys = [];
                const expiresAt = duration ? new Date(Date.now() + duration * 1000 * 60 * 60 * 24) : null;
                for (let i = 0; i < quantity; i++) {
                    const randomKey = crypto.randomBytes(8).toString('hex').toUpperCase();
                    keys.push({ key: randomKey, appId, expiresAt });
                }

                await Key.insertMany(keys);
                result = { success: true, message: `Đã tạo ${quantity} key thành công.`, keys: keys.map(k => k.key) };
                break;
            }

            case 'checkkey': {
                const { key } = payload;
                const keyData = await Key.findOne({ key });
                if (!keyData) {
                    return res.status(404).json({ success: false, message: 'Key không tồn tại.' });
                }
                result = { success: true, keyData };
                break;
            }

            case 'deleteexpiredkeys':
            case 'deleteexpired': {
                const { appId } = payload;
                const resultDB = await Key.deleteMany({ appId, expiresAt: { $lt: new Date() } });
                result = { success: true, message: `Đã xóa ${resultDB.deletedCount} key hết hạn.` };
                break;
            }

            case 'deletekey': {
                const { key } = payload;
                const resultDB = await Key.deleteOne({ key });
                if (resultDB.deletedCount === 0) {
                    return res.status(404).json({ success: false, message: 'Key không tồn tại.' });
                }
                result = { success: true, message: 'Đã xóa key thành công.' };
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

            case 'enable':
            case 'disable': {
                const { targetId } = payload;
                const newStatus = action === 'enable';
                const resultDB = await User.findOneAndUpdate(
                    { discordId: targetId },
                    { isBotEnabled: newStatus },
                    { new: true, upsert: true }
                );
                result = { success: true, message: `Đã ${newStatus ? 'cho phép' : 'gỡ quyền'} người dùng ${targetId}.` };
                break;
            }

            default:
                result = { success: false, message: 'Lệnh không hợp lệ.' };
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('Lỗi API:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ.' });
    }
});

module.exports = app;
