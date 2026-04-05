import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const OUTPUT_PATH = "team-data.js";
const CLUB_NAME = "TSV Hainsfarth";
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const TEAM_CONFIG = {
  team1: {
    key: "team1",
    label: "1. Mannschaft",
    eyebrow: "Herren I",
    heroTitle: "Spielerkarten und Aufstellung.",
    heroBadge: "Herren I",
    seasonLabel: "Kader 2025/2026",
    seasonNote: "Mit Spielerkarten und Staff der ersten Mannschaft.",
    sourceLabel: "FuPa-Teamseite TSV Hainsfarth",
    sourceUrl: "https://www.fupa.net/team/tsv-hainsfarth-m1-2025-26",
    sectionEyebrow: "Herren I Kader",
    sectionTitle: "Alle Spieler auf einen Blick",
    sectionLead: "Alle Spielerkarten der ersten Mannschaft auf einen Blick mit Foto, Position und Leistungsdaten.",
    sourceKey: "TeamPlayersPage",
    teamPageKey: "TeamPage",
  },
  team2: {
    key: "team2",
    label: "2. Mannschaft",
    eyebrow: "Herren II",
    heroTitle: "Spielerkarten und Aufstellung.",
    heroBadge: "Herren II",
    seasonLabel: "Kader 2025/2026",
    seasonNote: "Mit Spielerkarten und Staff der zweiten Mannschaft.",
    sourceLabel: "FuPa-Teamseite TSV Hainsfarth II",
    sourceUrl: "https://www.fupa.net/team/tsv-hainsfarth-m2-2025-26",
    sectionEyebrow: "Herren II Kader",
    sectionTitle: "Alle Spieler auf einen Blick",
    sectionLead: "Alle Spielerkarten der zweiten Mannschaft auf einen Blick mit Foto, Position und Leistungsdaten.",
    sourceKey: "TeamPlayersPage",
    teamPageKey: "TeamPage",
  },
};

const parseExistingSquadData = async () => {
  const source = await readFile(OUTPUT_PATH, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.tsvSquadData || null;
};

const extractScriptJson = (scriptContent) => {
  const jsonStart = scriptContent.indexOf("{");

  if (jsonStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < scriptContent.length; index += 1) {
    const char = scriptContent[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return scriptContent.slice(jsonStart, index + 1);
      }
    }
  }

  return null;
};

const extractReduxData = (html) => {
  const scriptContents = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);

  const directReduxScript = scriptContents.find((content) => content.includes("window.REDUX_DATA"));

  if (directReduxScript) {
    const directJson = extractScriptJson(directReduxScript);

    if (directJson) {
      return JSON.parse(directJson);
    }
  }

  const dataHistoryScript = scriptContents.find(
    (content) => content.includes("\"dataHistory\"") && content.includes("\"header\"")
  );

  if (dataHistoryScript) {
    const fallbackJson = extractScriptJson(dataHistoryScript);

    if (fallbackJson) {
      return JSON.parse(fallbackJson);
    }
  }

  throw new Error("Could not find parseable FuPa state in page");
};

const fetchTeamPayload = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; TSVHainsfarthBot/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`FuPa request failed for ${url}: ${response.status}`);
  }

  const html = await response.text();
  return extractReduxData(html);
};

const fetchTeamPayloadSafe = async (config) => {
  try {
    const reduxData = await fetchTeamPayload(config.sourceUrl);
    return { reduxData, error: null };
  } catch (error) {
    return { reduxData: null, error };
  }
};

const findDataHistoryEntry = (reduxData, key) => {
  const dataHistory = Array.isArray(reduxData?.dataHistory) ? reduxData.dataHistory : [];
  return dataHistory.find((entry) => entry?.[key])?.[key] || null;
};

const toImageUrl = (image) => image?.path || "";

const normalizeRole = (role = "") => {
  if (!role) {
    return "";
  }

  const normalized = role.trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const personExtrasById = (entries = []) =>
  Object.fromEntries(
    entries
      .filter((entry) => entry && typeof entry.id !== "undefined")
      .map((entry) => {
        const extras = { ...entry };
        delete extras.id;
        delete extras.firstName;
        delete extras.lastName;
        delete extras.position;
        delete extras.role;
        delete extras.jerseyNumber;
        delete extras.matches;
        delete extras.goals;
        delete extras.flags;
        delete extras.age;
        delete extras.imageUrl;
        return [entry.id, extras];
      })
  );

const mergeExtras = (baseEntry, extrasMap) => {
  const extras = extrasMap[baseEntry.id];
  return extras && Object.keys(extras).length ? { ...baseEntry, ...extras } : baseEntry;
};

const buildTeam = ({ config, reduxData, existingTeam }) => {
  const playersPage = findDataHistoryEntry(reduxData, config.sourceKey);
  const teamPage = findDataHistoryEntry(reduxData, config.teamPageKey);

  if (!playersPage?.data?.players || !teamPage?.competition) {
    throw new Error(`Missing expected FuPa data for ${config.key}`);
  }

  const playerExtras = personExtrasById(existingTeam?.players);
  const staffExtras = personExtrasById(existingTeam?.staff);
  const competitionName = teamPage.competition?.name || "";
  const heroLeadTeamName =
    config.key === "team1" ? "des TSV Hainsfarth" : "des TSV Hainsfarth II";
  const heroLead =
    `Der Kader basiert auf der FuPa-Teamseite ${heroLeadTeamName}, Stand ${TODAY}. ` +
    `Hier sieht man Spieler, Trainerteam und alle Daten gesammelt auf einer eigenen Seite.`;

  return {
    key: config.key,
    label: config.label,
    eyebrow: config.eyebrow,
    heroTitle: config.heroTitle,
    heroLead,
    heroBadge: config.heroBadge,
    seasonLabel: config.seasonLabel,
    seasonNote: config.seasonNote,
    sourceDate: TODAY,
    sourceLabel: config.sourceLabel,
    sourceUrl: config.sourceUrl,
    sectionEyebrow: config.sectionEyebrow,
    sectionTitle: config.sectionTitle,
    sectionLead: config.sectionLead,
    competition: competitionName,
    players: playersPage.data.players.map((player) =>
      mergeExtras(
        {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          position: player.position,
          jerseyNumber: player.jerseyNumber ?? null,
          matches: player.matches ?? 0,
          goals: player.goals ?? 0,
          flags: Array.isArray(player.flags) ? player.flags : [],
          age: player.age ?? null,
          imageUrl: toImageUrl(player.image),
        },
        playerExtras
      )
    ),
    staff: (playersPage.data.coaches || []).map((coach) =>
      mergeExtras(
        {
          id: coach.id,
          firstName: coach.firstName,
          lastName: coach.lastName,
          role: normalizeRole(coach.role),
          age: coach.age ?? null,
          imageUrl: toImageUrl(coach.image),
        },
        staffExtras
      )
    ),
  };
};

const serialize = (value, indent = 0) => {
  const spacing = "  ".repeat(indent);
  const nextSpacing = "  ".repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const items = value.map((item) => `${nextSpacing}${serialize(item, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${spacing}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, nestedValue]) => {
      return `${nextSpacing}${key}: ${serialize(nestedValue, indent + 1)}`;
    });

    return `{\n${entries.join(",\n")}\n${spacing}}`;
  }

  return JSON.stringify(value);
};

const main = async () => {
  const existingData = await parseExistingSquadData();
  const [team1Result, team2Result] = await Promise.all([
    fetchTeamPayloadSafe(TEAM_CONFIG.team1),
    fetchTeamPayloadSafe(TEAM_CONFIG.team2),
  ]);

  const fallbackWarnings = [];
  const buildTeamWithFallback = (config, result, existingTeam) => {
    if (result.reduxData) {
      return buildTeam({
        config,
        reduxData: result.reduxData,
        existingTeam,
      });
    }

    if (existingTeam) {
      fallbackWarnings.push(
        `${config.key}: ${result.error?.message || "Unbekannter Fehler"}`
      );
      return existingTeam;
    }

    throw result.error || new Error(`Could not update ${config.key}`);
  };

  const output = {
    defaultTeam: existingData?.defaultTeam || "team1",
    teams: {
      team1: buildTeamWithFallback(
        TEAM_CONFIG.team1,
        team1Result,
        existingData?.teams?.team1
      ),
      team2: buildTeamWithFallback(
        TEAM_CONFIG.team2,
        team2Result,
        existingData?.teams?.team2
      ),
    },
  };

  const fileContents = `window.tsvSquadData = ${serialize(output)};\n`;
  await writeFile(OUTPUT_PATH, fileContents);
  if (fallbackWarnings.length) {
    console.warn(
      `FuPa voruebergehend nicht erreichbar, bestehende Daten weiterverwendet: ${fallbackWarnings.join(
        " | "
      )}`
    );
  }
  console.log(`Kaderdaten aktualisiert: ${TODAY}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
