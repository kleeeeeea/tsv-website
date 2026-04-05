import { readFile } from "node:fs/promises";

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || "https://yarlxyfkzhlcfkyiwtzp.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const ICS_PATH = "spielplan-tsv-hainsfarth.ics";
const CLUB_NAME = "TSV Hainsfarth";
const SEASON_LABEL = process.env.TSV_TIPPSPIEL_SEASON_LABEL?.trim() || "2025/2026";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt. Fuer sichere Schreibzugriffe wird der Service-Role-Key benoetigt.");
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

const parseIcsDate = (rawValue) => {
  const match = rawValue.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
};

const parseSummary = (summary) => {
  const [fixturePart = "", competition = "", league = ""] = summary.split(",").map((part) => part.trim());
  let opponent = fixturePart || CLUB_NAME;
  let isHome = fixturePart.startsWith(`${CLUB_NAME}-`);

  if (fixturePart.startsWith(`${CLUB_NAME}-`)) {
    opponent = fixturePart.slice(`${CLUB_NAME}-`.length);
    isHome = true;
  } else if (fixturePart.endsWith(`-${CLUB_NAME}`)) {
    opponent = fixturePart.slice(0, fixturePart.length - `-${CLUB_NAME}`.length);
    isHome = false;
  }

  return {
    competition,
    isHome,
    league,
    opponent: opponent.trim() || CLUB_NAME,
  };
};

const parseEvents = (icsText) => {
  const normalized = icsText.replace(/\r\n[ \t]/g, "").replace(/\r/g, "");

  return normalized
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((chunk) => {
      const getField = (fieldName) => {
        const fieldMatch = chunk.match(new RegExp(`${fieldName}[^:]*:(.+)`));
        return fieldMatch ? fieldMatch[1].trim() : "";
      };

      const summary = getField("SUMMARY").replace(/\\,/g, ",");
      return {
        location: getField("LOCATION").replace(/\\,/g, ","),
        start: parseIcsDate(getField("DTSTART")),
        summary,
        uid: getField("UID"),
        ...parseSummary(summary),
      };
    })
    .filter((event) => event.start instanceof Date && !Number.isNaN(event.start.getTime()) && event.uid)
    .sort((a, b) => a.start - b.start);
};

const syncMatches = async (rows) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/tippspiel_matches`, {
    method: "POST",
    headers: {
      ...supabaseHeaders,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`Supabase match upsert failed: ${response.status}`);
  }
};

const main = async () => {
  const icsText = await readFile(ICS_PATH, "utf8");
  const rows = parseEvents(icsText).map((event) => ({
    match_uid: event.uid,
    season: SEASON_LABEL,
    starts_at: event.start.toISOString(),
    competition: event.competition || null,
    league: event.league || null,
    is_home: event.isHome,
    opponent: event.opponent,
    location: event.location || null,
    home_team: event.isHome ? CLUB_NAME : event.opponent,
    away_team: event.isHome ? event.opponent : CLUB_NAME,
  }));

  if (!rows.length) {
    console.log("No tippspiel matches found in ICS.");
    return;
  }

  await syncMatches(rows);
  console.log(`Tippspiel match sync finished. Processed matches: ${rows.length}.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
