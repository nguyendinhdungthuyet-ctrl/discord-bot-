require('dotenv').config(); // Load .env
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ===== CẤU HÌNH GAME =====
let spawnInterval = 60;
let catchTime = 15;

// ===== DỮ LIỆU NGƯỜI CHƠI =====
let playerBags = {};
const dataFile = "./data.json";

if (fs.existsSync(dataFile)) {
  try {
    const raw = fs.readFileSync(dataFile);
    playerBags = JSON.parse(raw);
    console.log("✅ Dữ liệu người chơi đã load từ file.");
  } catch (e) {
    console.error("⚠️ Lỗi đọc data.json:", e);
    playerBags = {};
  }
}

function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(playerBags, null, 2));
}

// ===== DỮ LIỆU XE TĂNG =====
const activeSpawns = new Map();

const tankIcons = {
  "T-34-85": "🚩",
  "M4 Sherman": "⭐",
  "Tiger I": "🐯",
  "Panzer IV": "⚙️",
  "Panzer V Panther": "🐆",
  "KV-1": "🛡️",
  "IS-2": "💥",
  "Leopard 1": "🐆",
};

const tankImages = {
  "T-34-85": "https://upload.wikimedia.org/wikipedia/commons/6/6d/File:T-34_85_D-5T.png",
  "M4 Sherman": "https://upload.wikimedia.org/wikipedia/commons/0/07/Sherman_tank.png",
  "Tiger I": "https://upload.wikimedia.org/wikipedia/commons/a/a2/Tiger_I_Bovington.jpg",
  "Panzer IV": "https://upload.wikimedia.org/wikipedia/commons/4/47/AAF_Tank_Museum_Panzer_IV.jpg",
  "Panzer V Panther": "https://upload.wikimedia.org/wikipedia/commons/6/6f/Bundesarchiv_Bild_101I-299-1805-16%2C_Russland%2C_Panzer_V_%28Panther%29.jpg",
  "KV-1": "https://upload.wikimedia.org/wikipedia/commons/6/68/Soviet_tank_KV-1_model_1939.jpg",
  "IS-2": "https://upload.wikimedia.org/wikipedia/commons/2/20/IS-2_Cubinka_1.jpg",
  "Leopard 1": "https://upload.wikimedia.org/wikipedia/commons/8/81/Leopard1_cfb_borden_2.JPG",
};

const evolutionTable = {
  "T-34-85": "IS-2",
  "M4 Sherman": "Leopard 1",
  "Panzer IV": "Panzer V Panther",
  "KV-1": "IS-2",
};

// ===== HÀM SPAWN =====
function buildSpawnData() {
  const all = Object.keys(tankIcons);
  const correct = all[Math.floor(Math.random() * all.length)];
  let choices = [correct];
  while (choices.length < 3) {
    const pick = all[Math.floor(Math.random() * all.length)];
    if (!choices.includes(pick)) choices.push(pick);
  }
  choices = choices.sort(() => Math.random() - 0.5);
  const correctIndex = choices.indexOf(correct);
  return { correct, choices, correctIndex };
}

async function spawnInChannel(channel) {
  const data = buildSpawnData();
  const embed = new EmbedBuilder()
    .setTitle("🚩 Một chiếc xe tăng xuất hiện!")
    .setDescription("Nhấn vào tên đúng để đoán loại xe tăng này. Người nhấn nhanh nhất sẽ thắng!")
    .setFooter({ text: `Bạn có ${catchTime} giây để đoán!` })
    .setImage(tankImages[data.correct] || null);

  const row = new ActionRowBuilder();
  for (let i = 0; i < data.choices.length; i++) {
    const btn = new ButtonBuilder()
      .setCustomId(`spawn_${Date.now()}_${i}`)
      .setLabel(`${tankIcons[data.choices[i]] || "❓"} ${data.choices[i]}`)
      .setStyle(ButtonStyle.Primary);
    row.addComponents(btn);
  }

  const msg = await channel.send({ embeds: [embed], components: [row] });
  const correctCustomId = row.components[data.correctIndex].data.custom_id;

  activeSpawns.set(msg.id, {
    correctCustomId,
    finished: false,
    message: msg,
    correctName: data.correct,
    embed,
  });

  const collector = msg.createMessageComponentCollector({ time: catchTime * 1000 });

  collector.on("collect", async (interaction) => {
    const spawn = activeSpawns.get(msg.id);
    if (!spawn || spawn.finished) return interaction.reply({ content: "❌ Đã kết thúc rồi.", ephemeral: true });

    if (interaction.customId === spawn.correctCustomId) {
      spawn.finished = true;
      addToBag(interaction.user.id, spawn.correctName);

      const evoResult = checkEvolution(interaction.user.id, spawn.correctName);
      let evoMsg = "";
      if (evoResult) {
        evoMsg = `\n🌟 **Tiến hoá!** ${tankIcons[spawn.correctName] || ""} ${spawn.correctName} → **${tankIcons[evoResult] || ""} ${evoResult}**!`;
      }

      const disabledRow = new ActionRowBuilder();
      row.components.forEach((btn) =>
        disabledRow.addComponents(ButtonBuilder.from(btn).setDisabled(true))
      );

      await msg.edit({
        content: `🏆 ${interaction.user} đã đoán đúng! Đó là **${tankIcons[spawn.correctName] || ""} ${spawn.correctName}**!${evoMsg}`,
        embeds: [spawn.embed],
        components: [disabledRow],
      });
      await interaction.reply({
        content: `🎉 Bạn đã thêm **${tankIcons[spawn.correctName] || ""} ${spawn.correctName}** vào kho xe.${evoMsg}`,
        ephemeral: true,
      });
      collector.stop("won");
    } else {
      await interaction.reply({ content: "😅 Sai rồi!", ephemeral: true });
    }
  });

  collector.on("end", async (_, reason) => {
    const spawn = activeSpawns.get(msg.id);
    if (!spawn) return;
    if (!spawn.finished && reason !== "won") {
      const disabledRow = new ActionRowBuilder();
      row.components.forEach((btn) =>
        disabledRow.addComponents(ButtonBuilder.from(btn).setDisabled(true))
      );
      await msg.edit({
        content: `⌛ Hết thời gian! Đó chính là **${tankIcons[spawn.correctName] || ""} ${spawn.correctName}**.`,
        embeds: [spawn.embed],
        components: [disabledRow],
      });
    }
    activeSpawns.delete(msg.id);
  });
}

// ===== QUẢN LÝ KHO =====
function addToBag(userId, tank) {
  if (!playerBags[userId]) playerBags[userId] = [];
  playerBags[userId].push(tank);
  saveData();
}

function checkEvolution(userId, tank) {
  const evo = evolutionTable[tank];
  if (!evo) return null;
  const count = playerBags[userId].filter((t) => t === tank).length;
  if (count >= 2) {
    playerBags[userId] = playerBags[userId].filter((t) => t !== tank);
    playerBags[userId].push(evo);
    saveData();
    return evo;
  }
  return null;
}

function countTotal(userId) {
  return playerBags[userId] ? playerBags[userId].length : 0;
}

// ===== GAME LOOP =====
let spawnLoop = null;
function startGameLoop(channel) {
  if (spawnLoop) clearInterval(spawnLoop);
  spawnLoop = setInterval(() => spawnInChannel(channel), spawnInterval * 1000);
}
function stopGameLoop() {
  if (spawnLoop) clearInterval(spawnLoop);
  spawnLoop = null;
}

// ===== COMMANDS =====
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  if (cmd === "garage") {
    const bag = playerBags[message.author.id] || [];
    if (bag.length === 0) return message.reply("🪖 Kho xe của bạn trống.");
    const summary = {};
    bag.forEach((t) => (summary[t] = (summary[t] || 0) + 1));
    const desc = Object.entries(summary).map(([t, c]) => `${tankIcons[t] || "❓"} ${t} x${c}`).join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`🚗 Kho xe của ${message.author.username}`)
      .setDescription(desc)
      .setColor("Green");
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === "leaderboard") {
    const totals = Object.keys(playerBags).map((id) => ({ id, total: countTotal(id) }));
    totals.sort((a, b) => b.total - a.total);
    if (totals.length === 0) return message.reply("📉 Chưa có ai bắt được xe tăng.");
    const desc = totals.slice(0, 10).map((p, i) => `#${i + 1} <@${p.id}> — **${p.total} xe**`).join("\n");
    const embed = new EmbedBuilder().setTitle("🏆 Bảng xếp hạng").setDescription(desc);
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === "myrank") {
    const totals = Object.keys(playerBags).map((id) => ({ id, total: countTotal(id) }));
    const sorted = totals.sort((a, b) => b.total - a.total);
    const rank = sorted.findIndex((p) => p.id === message.author.id);
    if (rank === -1) return message.reply("📉 Bạn chưa có xe nào trong kho.");
    return message.reply(`🏅 Bạn đang ở **hạng #${rank + 1}** với **${sorted[rank].total} xe** trong kho.`);
  }

  if (cmd === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 Danh sách lệnh")
      .setDescription(`
**${PREFIX}garage** — Xem kho xe tăng của bạn.
**${PREFIX}leaderboard** — Xem top 10 người chơi.
**${PREFIX}myrank** — Xem hạng của riêng bạn.
**${PREFIX}startgame** — Bắt đầu game (quản trị viên).
**${PREFIX}stopgame** — Dừng game (quản trị viên).
**${PREFIX}settime <giây>** — Đặt thời gian bắt xe.
**${PREFIX}setspawn <giây>** — Đặt thời gian spawn xe.
**${PREFIX}help** — Hiện danh sách lệnh.
      `)
      .setColor("Blue");
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === "startgame") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply("❌ Bạn không có quyền.");
    startGameLoop(message.channel);
    return message.reply("▶️ Game đã bắt đầu!");
  }

  if (cmd === "stopgame") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply("❌ Bạn không có quyền.");
    stopGameLoop();
    return message.reply("⏹️ Game đã dừng.");
  }

  if (cmd === "settime") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply("❌ Bạn không có quyền.");
    const sec = parseInt(args[0]);
    if (isNaN(sec) || sec < 5) return message.reply("⚠️ Nhập số giây >= 5.");
    catchTime = sec;
    return message.reply(`⏲️ Thời gian bắt xe đặt thành ${sec} giây.`);
  }

  if (cmd === "setspawn") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply("❌ Bạn không có quyền.");
    const sec = parseInt(args[0]);
    if (isNaN(sec) || sec < 10) return message.reply("⚠️ Nhập số giây >= 10.");
    spawnInterval = sec;
    return message.reply(`🚀 Thời gian spawn đặt thành ${sec} giây.`);
  }
});

client.once("ready", () => {
  console.log(`Đã đăng nhập với ${client.user.tag}`);
});

client.login(TOKEN);
    
