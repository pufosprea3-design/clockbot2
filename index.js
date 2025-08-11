const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 📌 Citim variabilele de mediu (setate în Railway)
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

// 📌 Setăm calea folderului pentru salvarea datelor
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 📌 Asigurăm că folderul /data există
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '{}');

// 📌 Încărcăm datele din fișiere
let userData = JSON.parse(fs.readFileSync(DATA_FILE));
let historyData = JSON.parse(fs.readFileSync(HISTORY_FILE));

// 📌 Funcție pentru salvarea datelor
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2));
}

// 📌 Inițializăm clientul Discord
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// 📌 Creăm comenzile slash
const commands = [
    new SlashCommandBuilder()
        .setName('calculpontaj')
        .setDescription('Calculează pontajul tău total.'),
    new SlashCommandBuilder()
        .setName('pontajtotalgeneral')
        .setDescription('Afișează pontajele totale ale tuturor utilizatorilor.')
].map(command => command.toJSON());

// 📌 Înregistrăm comenzile slash
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('📡 Înregistrez comenzile slash...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Comenzile au fost înregistrate!');
    } catch (error) {
        console.error(error);
    }
})();

// 📌 Când botul e online
client.once(Events.ClientReady, () => {
    console.log(`✅ Botul este online ca ${client.user.tag}`);

    // Mesaj cu butoane în canalul specificat
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (channel) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('clockin').setLabel('Clock In').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('clockout').setLabel('Clock Out').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('checktime').setLabel('Check Time').setStyle(ButtonStyle.Primary)
            );
        channel.send({ content: '📋 Alege o acțiune:', components: [row] });
    }
});

// 📌 Gestionăm interacțiunile cu butoane și slash
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton()) {
        const userId = interaction.user.id;
        const now = Date.now();

        if (interaction.customId === 'clockin') {
            if (userData[userId] && userData[userId].start) {
                return interaction.reply({ content: '⚠️ Ești deja în pontaj!', ephemeral: true });
            }
            userData[userId] = { start: now };
            saveData();
            return interaction.reply({ content: '✅ Pontaj început!', ephemeral: true });

        } else if (interaction.customId === 'clockout') {
            if (!userData[userId] || !userData[userId].start) {
                return interaction.reply({ content: '⚠️ Nu ai pontaj activ!', ephemeral: true });
            }
            const diff = now - userData[userId].start;
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff / (1000 * 60)) % 60);

            historyData[userId] = (historyData[userId] || 0) + diff;
            delete userData[userId];
            saveData();

            return interaction.reply({ content: `✅ Pontaj încheiat! Ai lucrat ${hours}h ${minutes}m.`, ephemeral: true });

        } else if (interaction.customId === 'checktime') {
            if (!userData[userId] || !userData[userId].start) {
                return interaction.reply({ content: '⚠️ Nu ai pontaj activ!', ephemeral: true });
            }
            const diff = now - userData[userId].start;
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            return interaction.reply({ content: `🕒 Timp lucrat: ${hours}h ${minutes}m`, ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand()) {
        const userId = interaction.user.id;

        if (interaction.commandName === 'calculpontaj') {
            const total = (historyData[userId] || 0) + (userData[userId] ? (Date.now() - userData[userId].start) : 0);
            const hours = Math.floor(total / (1000 * 60 * 60));
            const minutes = Math.floor((total / (1000 * 60)) % 60);
            return interaction.reply({ content: `📊 Pontajul tău total: ${hours}h ${minutes}m` });

        } else if (interaction.commandName === 'pontajtotalgeneral') {
            let result = '📋 **Pontaj total general:**\n';
            for (const id in historyData) {
                const total = historyData[id];
                const hours = Math.floor(total / (1000 * 60 * 60));
                const minutes = Math.floor((total / (1000 * 60)) % 60);
                result += `<@${id}>: ${hours}h ${minutes}m\n`;
            }
            return interaction.reply({ content: result || '⚠️ Nu există date de pontaj.' });
        }
    }
});

// 📌 Pornim botul
client.login(TOKEN);
