import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import vm from "node:vm";

const OUTPUT_PATH = "team-data.js";
const execFileAsync = promisify(execFile);
const CLUB_NAME = "TSV Hainsfarth";
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const getCurrentSeasonStartYear = () => {
  const now = new Date();
  const viennaMonth = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna",
      month: "2-digit",
    }).format(now)
  );
  const viennaYear = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna",
      year: "numeric",
    }).format(now)
  );

  return viennaMonth >= 7 ? viennaYear : viennaYear - 1;
};

const CURRENT_SEASON_START_YEAR = getCurrentSeasonStartYear();
const CURRENT_SEASON_END_YEAR = CURRENT_SEASON_START_YEAR + 1;
const CURRENT_SEASON_LABEL = `${CURRENT_SEASON_START_YEAR}/${CURRENT_SEASON_END_YEAR}`;
const CURRENT_SEASON_SLUG = `${CURRENT_SEASON_START_YEAR}-${String(CURRENT_SEASON_END_YEAR).slice(-2)}`;

const TEAM_CONFIG = {
  team1: {
    key: "team1",
    label: "1. Mannschaft",
    eyebrow: "Herren I",
    heroTitle: "Spielerkarten und Aufstellung.",
    heroBadge: "Herren I",
    seasonLabel: `Kader ${CURRENT_SEASON_LABEL}`,
    seasonNote: "Mit Spielerkarten und Staff der ersten Mannschaft.",
    sourceLabel: "FuPa-Teamseite TSV Hainsfarth",
    sourceUrl: `https://www.fupa.net/team/tsv-hainsfarth-m1-${CURRENT_SEASON_SLUG}`,
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
    seasonLabel: `Kader ${CURRENT_SEASON_LABEL}`,
    seasonNote: "Mit Spielerkarten und Staff der zweiten Mannschaft.",
    sourceLabel: "FuPa-Teamseite TSV Hainsfarth II",
    sourceUrl: `https://www.fupa.net/team/tsv-hainsfarth-m2-${CURRENT_SEASON_SLUG}`,
    sectionEyebrow: "Herren II Kader",
    sectionTitle: "Alle Spieler auf einen Blick",
    sectionLead: "Alle Spielerkarten der zweiten Mannschaft auf einen Blick mit Foto, Position und Leistungsdaten.",
    sourceKey: "TeamPlayersPage",
    teamPageKey: "TeamPage",
  },
};

const PLAYER_PAGE_BASE = "https://www.fupa.net/player/";
const PLAYER_FETCH_CONCURRENCY = 5;

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
  return {
    html,
    reduxData: extractReduxData(html),
  };
};

const fetchTeamPayloadSafe = async (config) => {
  try {
    const payload = await fetchTeamPayload(config.sourceUrl);
    return { ...payload, error: null };
  } catch (error) {
    return { html: null, reduxData: null, error };
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
        delete extras.slug;
        delete extras.firstName;
        delete extras.lastName;
        delete extras.position;
        delete extras.role;
        delete extras.jerseyNumber;
        delete extras.matches;
        delete extras.goals;
        delete extras.assists;
        delete extras.yellowCards;
        delete extras.yellowRedCards;
        delete extras.redCards;
        delete extras.teamOfWeek;
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

const playerProfileCache = new Map();

const extractBirthDateFromHtml = (html) => {
  if (!html) {
    return null;
  }

  const match = html.match(/"birthDate":"(\d{4}-\d{2}-\d{2})"/);
  return match ? match[1] : null;
};

const calculateAgeFromBirthDate = (birthDate) => {
  if (!birthDate) {
    return null;
  }

  const match = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const today = new Date(`${TODAY}T00:00:00+02:00`);
  const birth = new Date(`${birthDate}T00:00:00+02:00`);

  if (Number.isNaN(today.getTime()) || Number.isNaN(birth.getTime())) {
    return null;
  }

  let age = today.getFullYear() - birth.getFullYear();
  const hasHadBirthday =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());

  if (!hasHadBirthday) {
    age -= 1;
  }

  return age >= 0 ? age : null;
};

const fetchPlayerPayloadSafe = async (slug) => {
  if (!slug) {
    return { reduxData: null, error: new Error("Missing player slug") };
  }

  if (playerProfileCache.has(slug)) {
    return playerProfileCache.get(slug);
  }

  const request = fetchTeamPayloadSafe({
    sourceUrl: `${PLAYER_PAGE_BASE}${slug}`,
  });

  playerProfileCache.set(slug, request);
  return request;
};

const getPlayerSeasonEntries = (reduxData) => {
  const playerPage = findDataHistoryEntry(reduxData, "PlayerPage");
  return playerPage?.data?.playerRole?.seasons || [];
};

const findSeasonStatisticsForTeam = (seasonEntries, teamSlug) => {
  const matchingSeason = seasonEntries.find((season) => season?.team?.slug === teamSlug);
  return matchingSeason?.statistics || null;
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

const attachLiveSeasonStats = async ({ players, teamSlug }) => {
  return mapWithConcurrency(players, PLAYER_FETCH_CONCURRENCY, async (player) => {
    if (!player?.slug) {
      return player;
    }

    const { reduxData, html } = await fetchPlayerPayloadSafe(player.slug);
    const birthDate = extractBirthDateFromHtml(html);
    const liveAge = calculateAgeFromBirthDate(birthDate);

    if (!reduxData) {
      return {
        ...player,
        birthDate: birthDate || player.birthDate || null,
        age: liveAge ?? player.age ?? null,
      };
    }

    const seasonEntries = getPlayerSeasonEntries(reduxData);
    const statistics = findSeasonStatisticsForTeam(seasonEntries, teamSlug);

    if (!statistics) {
      return {
        ...player,
        birthDate: birthDate || player.birthDate || null,
        age: liveAge ?? player.age ?? null,
      };
    }

    return {
      ...player,
      birthDate: birthDate || player.birthDate || null,
      age: liveAge ?? player.age ?? null,
      assists: typeof statistics.assists === "number" ? statistics.assists : 0,
      yellowCards: typeof statistics.yellowCard === "number" ? statistics.yellowCard : 0,
      yellowRedCards: typeof statistics.yellowRedCard === "number" ? statistics.yellowRedCard : 0,
      redCards: typeof statistics.redCard === "number" ? statistics.redCard : 0,
      teamOfWeek: typeof statistics.topEleven === "number" ? statistics.topEleven : 0,
    };
  });
};

const attachLiveProfileAges = async (people) => {
  return mapWithConcurrency(people, PLAYER_FETCH_CONCURRENCY, async (person) => {
    if (!person?.slug) {
      return person;
    }

    const { html } = await fetchPlayerPayloadSafe(person.slug);
    const birthDate = extractBirthDateFromHtml(html);
    const liveAge = calculateAgeFromBirthDate(birthDate);

    return {
      ...person,
      birthDate: birthDate || person.birthDate || null,
      age: liveAge ?? person.age ?? null,
    };
  });
};

const buildTeam = async ({ config, reduxData, existingTeam }) => {
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
  const teamSlug = teamPage.slug;
  const basePlayers = playersPage.data.players.map((player) =>
    mergeExtras(
      {
        id: player.id,
        slug: player.slug,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        jerseyNumber: player.jerseyNumber ?? null,
        matches: player.matches ?? 0,
        goals: player.goals ?? 0,
        assists: 0,
        flags: Array.isArray(player.flags) ? player.flags : [],
        age: player.age ?? null,
        birthDate: player.birthDate ?? null,
        imageUrl: toImageUrl(player.image),
        yellowCards: 0,
        yellowRedCards: 0,
        redCards: 0,
        teamOfWeek: 0,
      },
      playerExtras
    )
  );
  const players = await attachLiveSeasonStats({
    players: basePlayers,
    teamSlug,
  });
  const staff = await attachLiveProfileAges(
    (playersPage.data.coaches || []).map((coach) =>
      mergeExtras(
        {
          id: coach.id,
          slug: coach.slug,
          firstName: coach.firstName,
          lastName: coach.lastName,
          role: normalizeRole(coach.role),
          age: coach.age ?? null,
          birthDate: coach.birthDate ?? null,
          imageUrl: toImageUrl(coach.image),
        },
        staffExtras
      )
    )
  );

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
    players,
    staff,
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
  const buildTeamWithFallback = async (config, result, existingTeam) => {
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
      team1: await buildTeamWithFallback(
        TEAM_CONFIG.team1,
        team1Result,
        existingData?.teams?.team1
      ),
      team2: await buildTeamWithFallback(
        TEAM_CONFIG.team2,
        team2Result,
        existingData?.teams?.team2
      ),
    },
  };

  const fileContents = `window.tsvSquadData = ${serialize(output)};\n`;
  await writeFile(OUTPUT_PATH, fileContents);
  try {
    await execFileAsync("python3", ["scripts/generate_player_cutouts.py"]);
  } catch (error) {
    console.warn(
      `Spieler-Cutouts konnten nicht aktualisiert werden, Squad-Daten bleiben trotzdem aktuell: ${
        error?.message || error
      }`
    );
  }
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
