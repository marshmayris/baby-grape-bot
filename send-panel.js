// ไฟล์: send-panel.js (เวอร์ชันอ่านจาก Secrets)

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// --- แก้ไขตรงนี้: อ่านค่าจาก Secrets โดยตรง ---
const token = process.env.DISCORD_TOKEN;
const controlChannelId = process.env.controlChannelId;

// ตรวจสอบว่ามีค่าที่จำเป็นใน Secrets หรือไม่
if (!token || !controlChannelId) {
    console.error('ไม่พบ token หรือ controlChannelId ใน Secrets! กรุณาตรวจสอบ');
    process.exit(1); // หยุดการทำงาน
}
// --- จบส่วนแก้ไข ---

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log('บอทพร้อมแล้ว! กำลังจะส่งแผงควบคุม...');

    const channel = await client.channels.fetch(controlChannelId);
    if (!channel) {
        console.error(`ไม่พบห้อง controlChannelId ที่มี ID: ${controlChannelId}!`);
        return client.destroy();
    }

    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        if (messages.size > 0) await channel.bulkDelete(messages, true);
        console.log(`ลบข้อความเก่า ${messages.size} ข้อความในห้องควบคุมเรียบร้อย`);
    } catch (error) {
        console.warn('ไม่สามารถลบข้อความเก่าได้ (อาจจะไม่มีสิทธิ์ หรือข้อความเก่าเกิน 14 วัน):', error.message);
    }

    const embed = new EmbedBuilder()
        .setColor('DarkGreen')
        .setTitle('💰 Heist Report Panel 💰')
        .setDescription('กดปุ่มด้านล่างเพื่อเริ่มบันทึกผลงานการทำกิจกรรมต่างๆ ของแก๊ง')
        .setThumbnail('https://img2.pic.in.th/pic/LOGO_12ebdf768694f5bef.png');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('start_heist_report') // ID สำหรับเริ่มระบบ Dropdown
                .setLabel('📝 เริ่มบันทึกผลงาน')
                .setStyle(ButtonStyle.Success)
                .setEmoji('💰'),
        );

    await channel.send({ embeds: [embed], components: [row] });
    console.log('ส่งแผงควบคุมเรียบร้อยแล้ว!');
    client.destroy(); // ปิดการทำงานของบอทหลังจากส่งเสร็จ
});

client.login(token);