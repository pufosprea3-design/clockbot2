// ==== Discord (buttons + slash) ====
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
} = require("discord.js");

// ==== Files (stocare temporară în /tmp) ====
const fs = require("fs");
const path = require("path");

// ==== ENV (setezi în Render → Environment) ====
const TOKEN = process.env.TOKEN;           // Discord Bot Token
const CLIENT_ID = process.env.CLIENT_ID;   // Discord Application ID
const CHANNEL_ID = process.env.CHANNEL_ID; // ID-ul canalului #pontaj

if (!TOKEN || !CLIENT_ID || !CHANNEL_ID) {
  console.error("❌ Lipsesc variabile: TOKEN, CLIENT_ID, CHANNEL_ID");
  process.exit(1);
}

// ==== Căi fișiere (/tmp pentru Render) ====
const DATA_FILE = path.join("/tmp", "clockbot.data.json");
const HISTORY_FILE = path.join("/tmp", "clockbot.history.json");

// ==== Utilitare fișiere ====
function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw || "null") ?? fallback;
  } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch {}
}

// ==== Date in-memory ====
let userData = readJsonSafe(DATA_FILE, {});
let historyData = readJsonSafe(HISTORY_FILE, {});
function saveAll() {
  writeJsonSafe(DATA_FILE, userData);
  writeJsonSafe(HISTORY_FILE, historyData);
}

// ==== Helpers timp ====
function fmtHM(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms / 60_000) % 60);
  return `${h}h ${m}m`;
}

// ==== Discord client ====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ==== Slash commands ====
const commands = [
  new SlashCommandBuilder()
    .setName("calculpontaj")
    .setDescription("Calculează pontajul tău total (incluzând sesiunea activă)."),
  new SlashCommandBuilder()
    .setName("pontajtotalgeneral")
    .setDescription("Afișează pontajele totale ale tuturor utilizatorilor.")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ==== Ready ====
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online ca ${client.user.tag}`);

  try {
    console.log("📡 Înregistrez slash commands…");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Comenzile au fost înregistrate!");
  } catch (e) {
    console.error("❌ Eroare la înregistrarea comenzilor:", e);
  }

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("clockin").setLabel("Clock In").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("clockout").setLabel("Clock Out").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("checktime").setLabel("Check Time").setStyle(ButtonStyle.Primary),
    );
    await channel.send({ content: "📌 **Pontaj** — folosește butoanele de mai jos:", components: [row] });
    console.log("✅ Mesajul cu butoane a fost trimis.");
  } catch (e) {
    console.error("❌ Nu pot trimite mesajul cu butoane:", e);
  }
});

// ==== Interacțiuni ====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --- Butoane ---
    if (interaction.isButton()) {
      await interaction.deferReply({ flags: 64 });

      const userId = interaction.user.id;
      const now = Date.now();

      if (interaction.customId === "clockin") {
        if (userData[userId]?.start) {
          return interaction.editReply("⏳ Ești deja pontat!");
        }
        userData[userId] = { start: now };
        saveAll();
        return interaction.editReply("✅ Pontaj început!");
      }

      if (interaction.customId === "clockout") {
        if (!userData[userId]?.start) {
          return interaction.editReply("❌ Nu ai pontaj activ!");
        }
        const diff = now - userData[userId].start;
        historyData[userId] = (historyData[userId] || 0) + diff;
        delete userData[userId];
        saveAll();
        return interaction.editReply(`✅ Pontaj încheiat. Ai lucrat **${fmtHM(diff)}**.`);
      }

      if (interaction.customId === "checktime") {
        if (!userData[userId]?.start) {
          return interaction.editReply("ℹ️ Nu ai pontaj activ.");
        }
        const diff = now - userData[userId].start;
        return interaction.editReply(`🕒 Timp curent: **${fmtHM(diff)}**`);
      }

      return;
    }

    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply(); // pentru slash, nu punem flags ca să fie public

      const userId = interaction.user.id;

      if (interaction.commandName === "calculpontaj") {
        const total = (historyData[userId] || 0) + (userData[userId]?.start ? (Date.now() - userData[userId].start) : 0);
        return interaction.editReply(`📊 Pontajul tău total: **${fmtHM(total)}**`);
      }

      if (interaction.commandName === "pontajtotalgeneral") {
        const entries = Object.entries(historyData);
        if (entries.length === 0 && Object.keys(userData).length === 0) {
          return interaction.editReply("📭 Nu există încă date de pontaj.");
        }
        const now = Date.now();
        const totals = new Map();
        for (const [uid, ms] of entries) totals.set(uid, (totals.get(uid) || 0) + ms);
        for (const [uid, obj] of Object.entries(userData)) {
          const extra = now - (obj.start || now);
          totals.set(uid, (totals.get(uid) || 0) + extra);
        }
        const lines = [...totals.entries()]
          .sort((a,b) => b[1] - a[1])
          .map(([uid, ms], i) => `${i + 1}. <@${uid}> — **${fmtHM(ms)}**`);
        return interaction.editReply(`📜 **Pontaj total general:**\n${lines.join("\n")}`);
      }
    }
  } catch (e) {
    console.error("❌ Eroare la interaction:", e);
    if (interaction.isRepliable()) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply("⚠️ A apărut o eroare. Încearcă din nou.");
        } else {
          await interaction.reply({ content: "⚠️ A apărut o eroare. Încearcă din nou.", flags: 64 });
        }
      } catch {}
    }
  }
});

// ==== HTTP keepalive pentru Render ====
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running!");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server pornit pe portul ${PORT}`);
});

// ==== Start bot ====
client.login(TOKEN);
