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

// ==== Căi fișiere (în /tmp, permis pe Render) ====
const DATA_FILE = path.join("/tmp", "clockbot.data.json");       // sesiuni active
const HISTORY_FILE = path.join("/tmp", "clockbot.history.json"); // totaluri ms

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

// ==== Date in-memory (încărcate din /tmp la start) ====
let userData = readJsonSafe(DATA_FILE, {});       // { userId: { start: epochMs } }
let historyData = readJsonSafe(HISTORY_FILE, {}); // { userId: totalMs }
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
  intents: [GatewayIntentBits.Guilds], // suficient pt slash + butoane
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

  // Înregistrează slash commands (global)
  try {
    console.log("📡 Înregistrez slash commands…");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Comenzile au fost înregistrate!");
  } catch (e) {
    console.error("❌ Eroare la înregistrarea comenzilor:", e);
  }

  // Trimite mesajul cu butoane în #pontaj
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

// ==== Interacțiuni (butoane + slash) ====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --- Butoane ---
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const now = Date.now();

      if (interaction.customId === "clockin") {
        if (userData[userId]?.start) {
          return interaction.reply({ content: "⏳ Ești deja pontat!", ephemeral: true });
        }
        userData[userId] = { start: now };
        saveAll();
        return interaction.reply({ content: "✅ Pontaj început!", ephemeral: true });
      }

      if (interaction.customId === "clockout") {
        if (!userData[userId]?.start) {
          return interaction.reply({ content: "❌ Nu ai pontaj activ!", ephemeral: true });
        }
        const diff = now - userData[userId].start;
        historyData[userId] = (historyData[userId] || 0) + diff;
        delete userData[userId];
        saveAll();
        return interaction.reply({ content: `✅ Pontaj încheiat. Ai lucrat **${fmtHM(diff)}**.`, ephemeral: true });
      }

      if (interaction.customId === "checktime") {
        if (!userData[userId]?.start) {
          return interaction.reply({ content: "ℹ️ Nu ai pontaj activ.", ephemeral: true });
        }
        const diff = now - userData[userId].start;
        return interaction.reply({ content: `🕒 Timp curent: **${fmtHM(diff)}**`, ephemeral: true });
      }

      return; // închidem ramura de butoane
    }

    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      const userId = interaction.user.id;

      if (interaction.commandName === "calculpontaj") {
        const total = (historyData[userId] || 0) + (userData[userId]?.start ? (Date.now() - userData[userId].start) : 0);
        return interaction.reply(`📊 Pontajul tău total: **${fmtHM(total)}**`);
      }

      if (interaction.commandName === "pontajtotalgeneral") {
        const entries = Object.entries(historyData);
        if (entries.length === 0 && Object.keys(userData).length === 0) {
          return interaction.reply("📭 Nu există încă date de pontaj.");
        }
        // includem și sesiunile active în raportul general
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
        return interaction.reply(`📜 **Pontaj total general:**\n${lines.join("\n")}`);
      }
    }
  } catch (e) {
    console.error("❌ Eroare la interaction:", e);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: "⚠️ A apărut o eroare. Încearcă din nou.", ephemeral: true }); } catch {}
    }
  }
});

// ==== Mini server HTTP pentru Render (Web Service) ====
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
