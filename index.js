
require('dotenv').config();

// ==================================================================
//  ส่วนของการ Import และตั้งค่าเริ่มต้น
// ==================================================================
const {
    Client,
    GatewayIntentBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    EmbedBuilder,
    UserSelectMenuBuilder,
    SlashCommandBuilder,
    PermissionsBitField,
} = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const express = require("express");
const app = express();

// --- อ่านค่าจาก Secrets ของ Replit ---
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.guildId;
const controlChannelId = process.env.controlChannelId;
const logChannelId = process.env.logChannelId;
const scoreChannelId = process.env.scoreChannelId;
const mentionRoleId = process.env.mentionRoleId;
let targetChannelId = process.env.targetChannelId;
const archiveCategoryId = process.env.archiveCategoryId;
const adminRoleId = process.env.adminRoleId;
const googleSheetUrl = process.env.googleSheetUrl;

// --- ตรวจสอบ Secrets ---
if (
    !token ||
    !guildId ||
    !controlChannelId ||
    !logChannelId ||
    !scoreChannelId ||
    !mentionRoleId ||
    !targetChannelId ||
    !archiveCategoryId ||
    !adminRoleId ||
    !googleSheetUrl
) {
    console.error(
        "ข้อมูลใน Secrets ไม่ครบถ้วน! กรุณาตรวจสอบทุกค่า รวมถึง googleSheetUrl",
    );
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const selectionStates = new Map();

// ==================================================================
//  ส่วนของระบบคะแนน (เวอร์ชัน 2 Scoreboards)
// ==================================================================
const scoresFilePath = path.join(__dirname, "scores.json");
function getScores() {
    if (!fs.existsSync(scoresFilePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(scoresFilePath));
    } catch (error) {
        return {};
    }
}
function saveScores(scores) {
    fs.writeFileSync(scoresFilePath, JSON.stringify(scores, null, 2));
}

async function updateScoreboard() {
    try {
        const scores = getScores();
        const channel = await client.channels.fetch(scoreChannelId);
        if (!channel) return console.error("ไม่พบห้อง scoreChannelId!");

        // --- สร้าง Embed สำหรับคะแนนรายสัปดาห์ ---
        const sortedWeekly = Object.entries(scores)
            .sort(
                ([, a], [, b]) => (b.weekly_score || 0) - (a.weekly_score || 0),
            )
            .slice(0, 25);
        const weeklyEmbed = new EmbedBuilder()
            .setColor("Aqua")
            .setTitle("📅 กระดานคะแนนประจำสัปดาห์ 📅")
            .setTimestamp()
            .setFooter({ text: "อัปเดตล่าสุด" });

        if (sortedWeekly.filter((s) => s[1].weekly_score > 0).length === 0) {
            weeklyEmbed.setDescription("ยังไม่มีผู้ทำคะแนนในสัปดาห์นี้...");
        } else {
            const weeklyText = sortedWeekly
                .map(([id, data], index) => {
                    const medals = ["🥇", "🥈", "🥉"];
                    const rank =
                        index < 3 ? medals[index] : `**${index + 1}.**`;
                    return `${rank} <@${id}> - **${data.weekly_score || 0}** คะแนน`;
                })
                .join("\n");
            weeklyEmbed.setDescription(weeklyText);
        }

        // --- สร้าง Embed สำหรับคะแนนสะสมรายเดือน ---
        const sortedMonthly = Object.entries(scores)
            .sort(
                ([, a], [, b]) =>
                    (b.monthly_score || 0) - (a.monthly_score || 0),
            )
            .slice(0, 20);
        const monthlyEmbed = new EmbedBuilder()
            .setColor("Gold")
            .setTitle("🗓️ กระดานคะแนนสะสมรายเดือน 🗓️")
            .setTimestamp()
            .setFooter({ text: "อัปเดตล่าสุด" });

        if (sortedMonthly.filter((s) => s[1].monthly_score > 0).length === 0) {
            monthlyEmbed.setDescription("ยังไม่มีคะแนนสะสม...");
        } else {
            const monthlyText = sortedMonthly
                .map(([id, data], index) => {
                    const medals = ["🥇", "🥈", "🥉"];
                    const rank =
                        index < 3 ? medals[index] : `**${index + 1}.**`;
                    return `${rank} <@${id}> - **${data.monthly_score || 0}** คะแนน`;
                })
                .join("\n");
            monthlyEmbed.setDescription(monthlyText);
        }

        // --- ค้นหาและอัปเดตข้อความที่ปักหมุดไว้ ---
        const pinnedMessages = await channel.messages.fetchPinned();

        const weeklyMessage = pinnedMessages.find(
            (msg) =>
                msg.author.id === client.user.id &&
                msg.embeds[0]?.title.includes("ประจำสัปดาห์"),
        );
        const monthlyMessage = pinnedMessages.find(
            (msg) =>
                msg.author.id === client.user.id &&
                msg.embeds[0]?.title.includes("สะสมรายเดือน"),
        );

        // อัปเดตหรือสร้างข้อความรายสัปดาห์
        if (weeklyMessage) {
            await weeklyMessage.edit({ embeds: [weeklyEmbed] });
        } else {
            const newWeeklyMsg = await channel.send({ embeds: [weeklyEmbed] });
            await newWeeklyMsg.pin();
        }

        // อัปเดตหรือสร้างข้อความรายเดือน
        if (monthlyMessage) {
            await monthlyMessage.edit({ embeds: [monthlyEmbed] });
        } else {
            const newMonthlyMsg = await channel.send({
                embeds: [monthlyEmbed],
            });
            await newMonthlyMsg.pin();
        }

        console.log("อัปเดตกระดานคะแนนทั้ง 2 บอร์ดเรียบร้อย");
    } catch (error) {
        console.error("เกิดข้อผิดพลาดขณะอัปเดตกระดานคะแนน:", error);
    }
}

// ==================================================================
//  ส่วนของระบบเก็บห้องแชท
// ==================================================================
async function archiveAndCreateNewChannel() {
    console.log("เบบี้เกรปได้รับสัญญาณ! กำลังจะเก็บห้องเก่าเข้ากรุแล้วน้า~");
    try {
        const originalChannel = await client.channels.fetch(targetChannelId);
        const archiveCategory = await client.channels.fetch(archiveCategoryId);
        if (!originalChannel || !archiveCategory)
            return console.error(
                "หาห้องเป้าหมายหรือหมวดหมู่เก็บประวัติไม่เจอ!",
            );

        await originalChannel.send(
            "**⚠️ ประกาศจากเบบี้เกรป ⚠️**\nห้องนี้กำลังจะถูกรีเซ็ตในอีก **10 วินาที** นะคร้าฟ...",
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await originalChannel.send("...**5**...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await originalChannel.send("...**4**...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await originalChannel.send("...**3**...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await originalChannel.send("...**2**...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await originalChannel.send("...**1**...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await originalChannel.send("**เริ่มทำการรีเซ็ตคับเบบี๋**");

        const transformedPermissions =
            originalChannel.permissionOverwrites.cache.map((p) => ({
                id: p.id,
                allow: p.allow.bitfield.toString(),
                deny: p.deny.bitfield.toString(),
                type: p.type === 0 ? "role" : "member",
            }));
        const channelData = {
            name: originalChannel.name,
            type: originalChannel.type,
            topic: originalChannel.topic,
            position: originalChannel.position,
            parent: originalChannel.parent,
            permissionOverwrites: transformedPermissions,
        };
        const date = new Date();
        const dateString = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;
        const archiveName = `${channelData.name}-ประวัติ-ลบ-${dateString}`;
        const archivePermissions = [
            {
                id: originalChannel.guild.roles.everyone.id,
                deny: ["ViewChannel"],
            },
            { id: adminRoleId, allow: ["ViewChannel", "ReadMessageHistory"] },
            {
                id: client.user.id,
                allow: ["ViewChannel", "ManageChannels", "ManageRoles"],
            },
        ];

        await originalChannel.edit({
            name: archiveName,
            parent: archiveCategory.id,
            permissionOverwrites: archivePermissions,
        });
        console.log(
            `ห้องเก่าถูกเก็บเข้ากรุและซ่อนในชื่อ "${archiveName}" เรียบร้อย!`,
        );

        const newChannel = await originalChannel.guild.channels.create({
            ...channelData,
        });
        console.log(
            `สร้างห้องใหม่ "${newChannel.name}" สำเร็จ! ID คือ: ${newChannel.id}`,
        );

        targetChannelId = newChannel.id;
        console.log(
            `อัปเดต ID ห้องเป้าหมายในหน่วยความจำเป็น: ${targetChannelId}`,
        );

        await newChannel.send(
            `hello 1975 ⋆｡˚ ☁︎ ˚｡⋆｡ \nเบบี้เกรปลบห้องเก่าสร้างห้องใหม่ให้ละคร้าฟฟ! ก็เหมือนอกไก่ต้องมีคนหมัก อกหักต้องมีคนใหม่นะคะพี่ๆ สุดท้ายนี้องุ่นโสด จุ้บๆ`,
        );
    } catch (error) {
        console.error("[แงงง~] เบบี้เกรปทำพลาด (ส่วนเก็บห้อง):", error);
    }
}

// ==================================================================
//  Event Handlers (ศูนย์บัญชาการ)
// ==================================================================
client.once("ready", () => {
    console.log(`เบบี้เกรป (${client.user.tag}) พร้อมทำงานทุกอย่างแล้วค่า! 🍇`);
    cron.schedule(
        "0 0 */3 * *",
        () => {
            archiveAndCreateNewChannel();
        },
        { scheduled: true, timezone: "Asia/Bangkok" },
    );
    console.log("ตั้งเวลาระบบเก็บห้องแชทเรียบร้อย!");
    updateScoreboard();
});

client.on("interactionCreate", async (interaction) => {
    try {
        // --- จัดการการกดปุ่ม "เริ่มบันทึกผลงาน" ---
        if (
            interaction.isButton() &&
            interaction.customId === "start_heist_report"
        ) {
            selectionStates.set(interaction.user.id, {
                activity: null,
                members: [],
                time: null,
            });
            const activitySelect = new StringSelectMenuBuilder()
                .setCustomId(`activity_select_menu_${interaction.user.id}`)
                .setPlaceholder("1. เลือกประเภทกิจกรรม")
                .addOptions([
                    { label: "💰 งัดร้าน", value: "งัดร้าน" },
                    { label: "🏦 งัดธนาคาร", value: "งัดธนาคาร" },
                    { label: "📦 ลูทบ็อก", value: "ลูทบ็อก" },
                ]);
            const timeSelect = new StringSelectMenuBuilder()
                .setCustomId(`time_select_menu_${interaction.user.id}`)
                .setPlaceholder("2. เลือกช่วงเวลา")
                .addOptions([
                    { label: "☀️ พีคไทม์ (+10 คะแนน , 18:00 - 02:00)", value: "peak" },
                    { label: "🌙 นอกเวลา (+2 คะแนน , 02:00 - 17:59)", value: "offpeak" },
                ]);
            const memberSelect = new UserSelectMenuBuilder()
                .setCustomId(`member_select_menu_${interaction.user.id}`)
                .setPlaceholder("3. เลือกสมาชิกที่เข้าร่วม")
                .setMinValues(1)
                .setMaxValues(5);
            const confirmButton = new ButtonBuilder()
                .setCustomId(`confirm_heist_details_${interaction.user.id}`)
                .setLabel("4. กรอกข้อมูลและยืนยัน")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true);
            await interaction.reply({
                content: "กรุณาเลือกข้อมูลด้านล่างให้ครบถ้วน:",
                components: [
                    new ActionRowBuilder().addComponents(activitySelect),
                    new ActionRowBuilder().addComponents(timeSelect),
                    new ActionRowBuilder().addComponents(memberSelect),
                    new ActionRowBuilder().addComponents(confirmButton),
                ],
                ephemeral: true,
            });
        }

        // --- จัดการการเลือก Dropdown และ User Select ---
        if (interaction.isAnySelectMenu()) {
            const userId = interaction.user.id;
            const state = selectionStates.get(userId);
            if (!state) return;
            if (interaction.customId.startsWith("activity_select_menu")) {
                state.activity = interaction.values[0];
            } else if (interaction.customId.startsWith("time_select_menu")) {
                state.time = interaction.values[0];
            } else if (interaction.customId.startsWith("member_select_menu")) {
                state.members = interaction.values;
            }
            const newActivitySelect = StringSelectMenuBuilder.from(
                interaction.message.components[0].components[0],
            ).setOptions(
                interaction.message.components[0].components[0].options.map(
                    (opt) => ({
                        ...opt,
                        default: opt.value === state.activity,
                    }),
                ),
            );
            const newTimeSelect = StringSelectMenuBuilder.from(
                interaction.message.components[1].components[0],
            ).setOptions(
                interaction.message.components[1].components[0].options.map(
                    (opt) => ({ ...opt, default: opt.value === state.time }),
                ),
            );
            const newMemberSelect = UserSelectMenuBuilder.from(
                interaction.message.components[2].components[0],
            ).setDefaultUsers(state.members);
            const newConfirmButton = ButtonBuilder.from(
                interaction.message.components[3].components[0],
            ).setDisabled(
                !(state.activity && state.time && state.members.length > 0),
            );
            await interaction.update({
                components: [
                    new ActionRowBuilder().addComponents(newActivitySelect),
                    new ActionRowBuilder().addComponents(newTimeSelect),
                    new ActionRowBuilder().addComponents(newMemberSelect),
                    new ActionRowBuilder().addComponents(newConfirmButton),
                ],
            });
        }

        // --- จัดการการกดปุ่ม "ยืนยัน" ---
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("confirm_heist_details")
        ) {
            const userId = interaction.user.id;
            const state = selectionStates.get(userId);
            if (
                !state ||
                !state.activity ||
                !state.time ||
                !state.members.length === 0
            ) {
                return interaction.reply({
                    content: "ข้อมูลยังไม่ครบถ้วน!",
                    ephemeral: true,
                });
            }
            state.buttonInteraction = interaction;
            let modal;
            if (state.activity === "งัดร้าน") {
                modal = new ModalBuilder()
                    .setCustomId(`heist_store_modal_${userId}`)
                    .setTitle(`บันทึกผลงาน: ${state.activity}`);
                const imageUrlFrontInput = new TextInputBuilder()
                    .setCustomId("image_url_front_input")
                    .setLabel("URL รูปภาพหน้าร้าน")
                    .setPlaceholder(
                        "อัปโหลดรูปลง Discord > คลิกขวา > Copy Link",
                    )
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                const imageUrlBackInput = new TextInputBuilder()
                    .setCustomId("image_url_back_input")
                    .setLabel("URL รูปภาพหลังร้าน")
                    .setPlaceholder(
                        "อัปโหลดรูปลง Discord > คลิกขวา > Copy Link",
                    )
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                const notesInput = new TextInputBuilder()
                    .setCustomId("notes_input")
                    .setLabel("หมายเหตุ (ถ้ามี)")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(imageUrlFrontInput),
                    new ActionRowBuilder().addComponents(imageUrlBackInput),
                    new ActionRowBuilder().addComponents(notesInput),
                );
            } else {
                modal = new ModalBuilder()
                    .setCustomId(`heist_default_modal_${userId}`)
                    .setTitle(`บันทึกผลงาน: ${state.activity}`);
                const imageUrlInput = new TextInputBuilder()
                    .setCustomId("image_url_input")
                    .setLabel("URL รูปภาพหลักฐาน")
                    .setPlaceholder(
                        "อัปโหลดรูปลง Discord > คลิกขวา > Copy Link",
                    )
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                const notesInput = new TextInputBuilder()
                    .setCustomId("notes_input")
                    .setLabel("หมายเหตุ (ถ้ามี)")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(imageUrlInput),
                    new ActionRowBuilder().addComponents(notesInput),
                );
            }
            await interaction.showModal(modal);
        }

        // --- จัดการการส่งฟอร์ม Modal ---
        if (interaction.isModalSubmit()) {
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const state = selectionStates.get(userId);
            if (!state) return;
            try {
                if (state.buttonInteraction) {
                    const originalMessage = state.buttonInteraction.message;
                    const disabledComponents = originalMessage.components.map(
                        (row) => {
                            const newRow = ActionRowBuilder.from(row);
                            newRow.components.forEach((comp) =>
                                comp.setDisabled(true),
                            );
                            return newRow;
                        },
                    );
                    await state.buttonInteraction.editReply({
                        content: "รายการนี้ถูกส่งเรียบร้อยแล้ว ✅",
                        components: disabledComponents,
                    });
                }
            } catch (err) {
                console.log("ไม่สามารถแก้ไขข้อความเดิมได้:", err.message);
            }
            const { activity, time, members: memberIds } = state;
            let imageUrlFront, imageUrlBack, notes;
            if (interaction.customId.startsWith("heist_store_modal")) {
                imageUrlFront = interaction.fields.getTextInputValue(
                    "image_url_front_input",
                );
                imageUrlBack = interaction.fields.getTextInputValue(
                    "image_url_back_input",
                );
                notes =
                    interaction.fields.getTextInputValue("notes_input") ||
                    "ไม่มี";
            } else if (interaction.customId.startsWith("heist_default_modal")) {
                imageUrlFront =
                    interaction.fields.getTextInputValue("image_url_input");
                imageUrlBack = "";
                notes =
                    interaction.fields.getTextInputValue("notes_input") ||
                    "ไม่มี";
            } else {
                return;
            }
            // --- เพิ่มส่วนนี้เข้ามา: ตรวจสอบความถูกต้องของ URL (เวอร์ชันใหม่) ---
            // 1. ต้องขึ้นต้นด้วย https://cdn.discordapp.com/
            // 2. ต้องไม่มีตัวอักษรภาษาไทย
            const discordCdnRegex = /^https:\/\/((cdn|media)\.discordapp\.(com|net))\/[^\s\u0E00-\u0E7F]*$/;

            // ตรวจสอบรูปที่ 1 (รูปหลัก)
            if (!discordCdnRegex.test(imageUrlFront)) {
                return interaction.editReply({
                    content: '❌ **URL รูปภาพหลักฐานไม่ถูกต้อง!**\nต้องเป็นลิงก์รูปภาพที่คัดลอกมาจาก Discord โดยตรง และห้ามมีอักษรภาษาไทย กรุณาส่งใหม่อีกครั้งนะคับ'
                });
            }

            // ตรวจสอบรูปที่ 2 (รูปหลังร้าน) ก็ต่อเมื่อมีค่าเท่านั้น
            if (imageUrlBack && !discordCdnRegex.test(imageUrlBack)) {
                return interaction.editReply({
                    content: '❌ **URL รูปภาพหลังร้านไม่ถูกต้อง!**\nต้องเป็นลิงก์รูปภาพที่คัดลอกมาจาก Discord โดยตรง และห้ามมีอักษรภาษาไทย กรุณาส่งใหม่อีกครั้งนะคับ'
                });
            }
            // --- จบส่วนที่เพิ่ม ---
            const scoreToAdd = time === "peak" ? 10 : 2;
            const timeText = time === "peak" ? "พีคไทม์" : "นอกเวลา";
            const memberObjects = interaction.guild.members.cache.filter(
                (member) => memberIds.includes(member.id),
            );
            if (memberObjects.size === 0) {
                return interaction.editReply({
                    content:
                        "ไม่สามารถหาข้อมูลสมาชิกที่เลือกได้เลย โปรดลองอีกครั้ง",
                });
            }
            const memberDisplayNames = memberObjects.map((m) => m.displayName);
            const memberMentions = memberObjects
                .map((m) => `<@${m.id}>`)
                .join(", ");
            // --- อัปเดตคะแนน ---
            const scores = getScores();
            memberObjects.forEach((member) => {
                const id = member.id;
                if (!scores[id]) {
                    scores[id] = {
                        tag: member.user.tag,
                        weekly_score: 0,
                        monthly_score: 0,
                    };
                }
                scores[id].weekly_score =
                    (scores[id].weekly_score || 0) + scoreToAdd;
            });
            saveScores(scores);
            await updateScoreboard();
            try {
                const payload = {
                    timestamp: new Date().toLocaleString("th-TH", {
                        timeZone: "Asia/Bangkok",
                    }),
                    initiator: interaction.user.tag,
                    activity: activity,
                    members: memberDisplayNames,
                    notes: notes,
                    imageUrlFront: imageUrlFront,
                    imageUrlBack: imageUrlBack,
                };
                await axios.post(googleSheetUrl, payload);
                console.log("ส่งข้อมูลไปที่ Google Sheets สำเร็จ!");
            } catch (error) {
                console.error(
                    "เกิดข้อผิดพลาดขณะส่งข้อมูลไปที่ Google Sheets:",
                    error.message,
                );
            }
            // --- สร้าง Embed (เพิ่ม Field ช่วงเวลา) ---
            const embed = new EmbedBuilder()
                .setColor("Red")
                .setTitle(`🚨 บันทึกผลงาน: ${activity}`)
                .setAuthor({
                    name: `บันทึกโดย: ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL(),
                })
                .addFields(
                    {
                        name: "⏰ ช่วงเวลา",
                        value: `${timeText} (+${scoreToAdd} คะแนน)`,
                        inline: false,
                    },
                    {
                        name: "👥 สมาชิกที่เข้าร่วม",
                        value: memberMentions,
                        inline: false,
                    },
                    {
                        name: "📝 หมายเหตุ",
                        value: `\`\`\`${notes}\`\`\``,
                        inline: false,
                    },
                )
                .setImage(imageUrlFront)
                .setTimestamp()
                .setFooter({ text: "Heist Report System" });
            if (imageUrlBack) {
                embed.setThumbnail(imageUrlBack);
            }

            const logChannel = await client.channels.fetch(logChannelId);
            await logChannel.send({
                content: `ผลงานใหม่จาก <@&${mentionRoleId}>`,
                embeds: [embed],
            });
            await interaction.editReply({
                content:
                    "บันทึกผลงานสำเร็จ! ข้อมูลถูกส่งไปที่ห้อง Log เรียบร้อย",
            });
            selectionStates.delete(userId);
        }

        // --- จัดการคำสั่ง Slash Command ---
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;
            if (
                !interaction.member.permissions.has(
                    PermissionsBitField.Flags.Administrator,
                )
            ) {
                return interaction.reply({
                    content: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้!",
                    ephemeral: true,
                });
            }
            if (commandName === "score") {
                const action = interaction.options.getString("action");
                const user = interaction.options.getUser("user");
                const amount = interaction.options.getNumber("amount");
                const scores = getScores();
                if (!scores[user.id]) {
                    scores[user.id] = {
                        tag: user.tag,
                        weekly_score: 0,
                        monthly_score: 0,
                    };
                }
                let responseText = "";
                if (action === "add") {
                    scores[user.id].weekly_score =
                        (scores[user.id].weekly_score || 0) + amount;
                    responseText = `เพิ่มคะแนนรายสัปดาห์ให้ ${user.tag} จำนวน ${amount} คะแนนเรียบร้อย`;
                } else if (action === "remove") {
                    scores[user.id].weekly_score =
                        (scores[user.id].weekly_score || 0) - amount;
                    responseText = `ลบคะแนนรายสัปดาห์ของ ${user.tag} จำนวน ${amount} คะแนนเรียบร้อย`;
                } else if (action === "set") {
                    scores[user.id].weekly_score = amount;
                    responseText = `ตั้งค่าคะแนนรายสัปดาห์ของ ${user.tag} เป็น ${amount} คะแนนเรียบร้อย`;
                }
                saveScores(scores);
                await updateScoreboard();
                await interaction.reply({
                    content: responseText,
                    ephemeral: true,
                });
            }
            if (commandName === "weekly_reset") {
                // 1. ตอบกลับแบบชั่วคราวทันที เพื่อให้ผู้ใช้รู้ว่าบอทรับคำสั่งแล้ว
                await interaction.reply({
                    content: "กำลังประมวลผลการตัดรอบประจำสัปดาห์...",
                    ephemeral: true,
                });

                const scores = getScores();
                const sortedWeekly = Object.entries(scores).sort(
                    ([, a], [, b]) =>
                        (b.weekly_score || 0) - (a.weekly_score || 0),
                );

                const embed = new EmbedBuilder()
                    .setColor("Aqua")
                    .setTitle("🎉 สรุปผลและตัดรอบคะแนนประจำสัปดาห์ 🎉")
                    .setDescription(
                        "คะแนนรายสัปดาห์ทั้งหมดจะถูกนำไปรวมกับคะแนนสะสมรายเดือน และคะแนนรายสัปดาห์จะถูกรีเซ็ตเป็น 0",
                    )
                    .setTimestamp();

                if (
                    sortedWeekly.length > 0 &&
                    sortedWeekly[0][1].weekly_score > 0
                ) {
                    const topPlayers = sortedWeekly
                        .slice(0, 5)
                        .map(([id, data], index) => {
                            return `**อันดับที่ ${index + 1}:** <@${id}> - **${(data.weekly_score || 0).toFixed(1)}** คะแนน`;
                        })
                        .join("\n");
                    embed.addFields({
                        name: "🏆 5 อันดับสูงสุดประจำสัปดาห์ 🏆",
                        value: topPlayers,
                    });
                } else {
                    embed.addFields({
                        name: "🏆 5 อันดับสูงสุดประจำสัปดาห์ 🏆",
                        value: "ไม่มีผู้ทำคะแนนในสัปดาห์นี้",
                    });
                }

                // 2. ส่งข้อความประกาศผลลงในช่องที่ใช้คำสั่ง (ซึ่งจะคงอยู่ถาวร)
                await interaction.channel.send({ embeds: [embed] });

                // 3. ทำการตัดรอบ
                for (const id in scores) {
                    scores[id].monthly_score =
                        (scores[id].monthly_score || 0) +
                        (scores[id].weekly_score || 0);
                    scores[id].weekly_score = 0;
                }
                saveScores(scores);

                // 4. แก้ไขข้อความตอบกลับชั่วคราว เพื่อแจ้งว่าเสร็จแล้ว
                await interaction.editReply({
                    content: "ตัดรอบประจำสัปดาห์เรียบร้อยแล้ว! ✅",
                });

                // 5. อัปเดตกระดานคะแนน
                await updateScoreboard();
            }
        }
    } catch (error) {
        console.error("เกิดข้อผิดพลาดใน interactionCreate:", error);
    }
});

// --- ส่วนของ MessageCreate (เหมือนเดิม) ---
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (
        message.content === "!reset" &&
        message.member?.permissions.has("Administrator")
    ) {
        await message.reply("รับแซ่บคร้าฟฟ เดะจัดการให้คับเธอ (๑•᎑< ๑)♡");
        await archiveAndCreateNewChannel();
    } else if (message.content === "!help") {
        const helpEmbed = new EmbedBuilder()
            .setColor("Green")
            .setTitle("🍇 คำสั่งทั้งหมดของเบบี้เกรป 🍇")
            .setDescription("นี่คือคำสั่งทั้งหมดที่สามารถใช้งานได้ค่ะ")
            .addFields(
                {
                    name: "--- 📝 สำหรับสมาชิกทุกคน ---",
                    value: "• **กดปุ่ม** ในห้อง `#heist-control` เพื่อเริ่มบันทึกผลงาน",
                },
                {
                    name: "--- 🛠️ สำหรับแอดมินเท่านั้น ---",
                    value:
                        "• `!reset` - สั่งรีเซ็ตห้องแชทเป้าหมายทันที\n" +
                        "• `/score` - จัดการคะแนนรายสัปดาห์ (เพิ่ม/ลบ/ตั้งค่า)\n" +
                        "• `/weekly_reset` - ตัดรอบคะแนนประจำสัปดาห์ และโอนไปเป็นคะแนนสะสมรายเดือน",
                },
                {
                    name: "--- ✨ คำสั่งสนุกๆ ---",
                    value:
                        "• `!เรนบ้าจริงมั้ยเบบี้เกรป`\n" +
                        "• `!1975คืออะไร`\n" +
                        "• `!helpme lungtee`\n" +
                        "• `!ภักดีเป็นบ้าใช่มั้ย`\n" +
                        "• `!babygrape`",
                },
            )
            .setTimestamp()
            .setFooter({ text: "Baby Grape Heist System" });

        await message.reply({ embeds: [helpEmbed] });
    } else if (message.content === "!เรนบ้าจริงมั้ยเบบี้เกรป") {
        await message.reply("อันนี้เบบี้เกรปว่าจริงนะคับๆ");
    } else if (message.content === "!1975คืออะไร") {
        await message.reply(
            `💬 เมื่อมีคนถามว่า "1975 คืออะไร?"\nมีคนถามบ่อย...\nเสียงกระซิบข้างถนน, ในห้องสอบสวน, หรือใน Discord ตอนตีสอง\n\n“1975 คืออะไรวะ?”\n\nคนที่ไม่รู้ก็หัวเราะ\nคนที่เคยเจอก็เงียบ\nแต่คนที่ “รอดมาเล่าได้” จะบอกสั้น ๆ ว่า:\n\n"1975 ไม่ใช่ชื่อแก๊ง... มันคือคำเตือน"\nเพราะเบื้องหลังตัวเลขธรรมดา\nซ่อนตัวตนของชายคนหนึ่งไว้\nเขาคือ "Merge Realmaflow" หรือ "มาดิ" — ผู้วางหมากในโลกที่ไม่มีใครกล้าตั้งคำถาม\n\nเขาคือคนเดียวที่ Google ยังต้องถามก่อนจะให้คำตอบ\nพรีเซนต์ยังต้องจัดหน้าเองเวลาเขาเดินผ่าน\nในโลกจริง เขาคือความเนี๊ยบในร่างมนุษย์\nแต่ในโลกใต้ดิน... เขาคือผู้เขียนกฎใหม่ให้ถนน\n\nเพราะงั้น ถ้ามีใครยังถามว่า "1975 คืออะไร?"\nอย่าตอบ... แค่ถามกลับว่า\n"นายรู้จักพี่มาดิไหม?"\nถ้าเขาเงียบ — เขารู้\nถ้าเขาหัวเราะ — เขาจะได้รู้... ไม่นาน`,
        );
    } else if (message.content === "!helpme lungtee") {
        await message.reply(
            "lungteeไม่มีมีแต่เบบี้เกรปค้าฟฟฟ พี่ๆเลิกเพ้อได้แล้วนะ เอาเวลาเพ้อไปงัดร้าน รันแก๊งเถอะคับ",
        );
    } else if (message.content === "!ภักดีเป็นบ้าใช่มั้ย") {
        await message.reply("เบบี้เกรปว่าเค้าไม่ค่อยเต็มนะคับ");
    } else if (message.content === "!babygrape") {
        await message.reply("ค้าบบบบบบ");
    }
});

// --- เว็บเซิร์ฟเวอร์สำหรับ UptimeRobot ---
app.get("/", (req, res) => {
    res.send("Baby Grape is awake!");
});

app.listen(3000, () => {
    console.log("เว็บเซิร์ฟเวอร์สำหรับ UptimeRobot เริ่มทำงานที่ port 3000");
});

// --- ล็อกอินบอท ---
client.login(token);
