// ==== Discord & Utils ====
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

// ==== Postgres ====
const { Pool } = require("pg");

// ==== ENV (setezi în Render → Environment) ====
const TOKEN = process.env.TOKEN;           // Discord Bot Token
const CLIENT_ID = process.env.CLIENT_ID;   // Discord Application ID
const CHANNEL_ID = process.env.CHANNEL_ID; // ID canal #pontaj

if (!TOKEN || !CLIENT_ID || !CHANNEL_ID) {
  console.error("❌ Lipsesc variabile: TOKEN, CLIENT_ID, CHANNEL_ID");
  process.exit(1);
}

// Render oferă adesea DATABASE_URL; dacă nu, folosește PGHOST/PGUSER etc.
const connectionString = process.env.DATABASE_URL || undefined;

const pool = new Pool(
  connectionString
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false },
      }
);

// ==== Helper timp ====
function fmtHM(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms / 60_000) % 60);
  return `${h}h ${m}m`;
}

// ==== DB schema ====
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      start_ts TIMESTAMPTZ NOT NULL,
      end_ts   TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON work_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON work_sessions(user_id, end_ts);
  `);
}

// ==== Operații pontaj ====
async function hasActiveSession(userId) {
  const { rows } = await pool.query(
    `SELECT id, start_ts
       FROM work_sessions
      WHERE user_id = $1 AND end_ts IS NULL
   ORDER BY start_ts DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function startSession(userId, when = new Date()) {
  await pool.query(
    `INSERT INTO work_sessions (user_id, start_ts) VALUES ($1, $2)`,
    [userId, when]
  );
}

async function endSession(userId, when = new Date()) {
  const { rows } = await pool.query(
    `UPDATE work_sessions
        SET end_ts = $2
      WHERE user_id = $1 AND end_ts IS NULL
  RETURNING start_ts, end_ts`,
    [userId, when]
  );
  return rows[0] || null;
}

async function sumUserTotalMs(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(end_ts, NOW()) - start_ts)))*1000, 0) AS ms
       FROM work_sessions
      WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0]?.ms || 0);
}

async function sumAllTotals() {
  const { rows } = await pool.query(
    `SELECT user_id,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(end_ts, NOW()) - start_ts)))*1000, 0) AS ms
       FROM work_sessions
   GROUP BY user_id
   ORDER BY ms DESC`
  );
  return rows.map(r => ({ userId: r.user_id, ms: Number(r.ms || 0) }));
}

// ==== Discord client ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // suficient pentru slash + butoane
  ],
});

// ==== Slash commands ====
const commands = [
  new SlashCommandBuilder()
    .setName("calculpontaj")
    .setDescription("Calculează pontajul tău total (inclusiv sesiunea activă)."),
  new SlashCommandBuilder()
    .setName("pontajtotalgeneral")
    .setDescription("Afișează totalurile tuturor utilizatorilor."),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ==== Ready ====
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online ca ${client.user.tag}`);

  try {
    await ensureSchema();
    console.log("🗄️ Schema DB OK.");
  } catch (e) {
    console.error("❌ Eroare schema DB:", e);
    process.exit(1);
  }

  try {
    console.log("📡 Înregistrez slash commands…");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Comenzile au fost înregistrate!");
  } catch (e) {
    console.error("❌ Eroare la înregistrarea comenzilor:", e);
  }

  // Trimite butoanele în #pontaj
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

      if (interaction.customId === "clockin") {
        const active = await hasActiveSession(userId);
        if (active) {
          return interaction.reply({ content: "⏳ Ești deja pontat!", ephemeral: true });
        }
        await startSession(userId, new Date());
        return interaction.reply({ content: "✅ Pontaj început!", ephemeral: true });
      }

      if (interaction.customId === "clockout") {
        const active = await hasActiveSession(userId);
        if (!active) {
          return interaction.reply({ content: "❌ Nu ai pontaj activ!", ephemeral: true });
        }
        const ended = await endSession(userId, new Date());
        const ms = new Date(ended.end_ts).getTime() - new Date(ended.start_ts).getTime();
        return interaction.reply({ content: `✅ Pontaj încheiat. Ai lucrat **${fmtHM(ms)}**.`, ephemeral: true });
      }

      if (interaction.customId === "checktime") {
        const active = await hasActiveSession(userId);
        if (!active) {
          return interaction.reply({ content: "ℹ️ Nu ai pontaj activ.", ephemeral: true });
        }
        const ms = Date.now() - new Date(active.start_ts).getTime();
        return interaction.reply({ content: `🕒 Timp curent: **${fmtHM(ms)}**`, ephemeral: true });
      }

      return; // închidem ramura de butoane
    }

    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      const userId = interaction.user.id;

      if (interaction.commandName === "calculpontaj") {
        const totalMs = await sumUserTotalMs(userId);
        return interaction.reply(`📊 Pontajul tău total: **${fmtHM(totalMs)}**`);
      }

      if (interaction.commandName === "pontajtotalgeneral") {
        const all = await sumAllTotals();
        if (all.length === 0) return interaction.reply("📭 Nu există încă date de pontaj.");
        const lines = all.map((r, i) => `${i + 1}. <@${r.userId}> — **${fmtHM(r.ms)}**`);
        return interaction.reply(`📜 **Pontaj total general:**\n${lines.join("\n")}`);
      }
    }
  } catch (e) {
    console.error("❌ Eroare la interaction:", e);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "⚠️ A apărut o eroare. Încearcă din nou.", ephemeral: true });
      } catch {}
    }
  }
});

// ==== Start bot ====
client.login(TOKEN);
