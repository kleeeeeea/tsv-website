import { readFile, writeFile } from "node:fs/promises";

const ICS_PATH = "spielplan-tsv-hainsfarth.ics";
const OUTPUT_PATH = "matchday-live.json";
const CLUB_NAME = "TSV Hainsfarth";
const BFV_MATCH_BASE = "https://www.bfv.de/ergebnisse/spiel/-/";
const ACTIVE_MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;
const HISTORY_LIMIT = 5;
const BFV_TEAM_URL = "https://www.bfv.de/mannschaften/tsv-hainsfarth/016PHCS5TO000000VV0AG80NVUT1FLRU";

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
    fixture: fixturePart || CLUB_NAME,
    isHome,
    league,
    opponent: opponent.trim() || CLUB_NAME,
  };
};

const buildFixtureText = (event) =>
  event.isHome ? `${CLUB_NAME} vs. ${event.opponent}` : `${event.opponent} vs. ${CLUB_NAME}`;

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

      const baseEvent = {
        location: getField("LOCATION").replace(/\\,/g, ","),
        start: parseIcsDate(getField("DTSTART")),
        summary: getField("SUMMARY").replace(/\\,/g, ","),
        uid: getField("UID"),
      };

      return {
        ...baseEvent,
        ...parseSummary(baseEvent.summary),
      };
    })
    .filter((event) => event.start instanceof Date && !Number.isNaN(event.start.getTime()) && event.uid)
    .sort((a, b) => a.start - b.start);
};

const getCurrentOrNextEvent = (events) => {
  const now = Date.now();
  const currentEvent = events.find((event) => {
    const startTime = event.start.getTime();
    return now >= startTime && now <= startTime + ACTIVE_MATCH_WINDOW_MS;
  });

  if (currentEvent) {
    return currentEvent;
  }

  return events.find((event) => event.start.getTime() > now) || null;
};

const extractValue = (html, pattern) => {
  const match = html.match(pattern);
  return match ? match[1] : "";
};

const buildResultPayload = ({ html, event }) => {
  const status = extractValue(html, /"status":"([^"]+)"/);
  const live = extractValue(html, /"live":(true|false)/) === "true";
  const liveMinute = extractValue(html, /"liveMinute":"([^"]*)"/);
  const resultText = extractValue(html, /"result":\{"text":"([^"]*)","specialResult":(true|false)\}/);
  const specialResult = html.includes(`"result":{"text":"${resultText}","specialResult":true}`);
  const fontId = extractValue(html, /"obfuscatedFont":"([^"]+)"/);

  const hasResult = Boolean(resultText) && status !== "scheduled";
  let label = "BFV-Ergebnis";
  let note = "BFV";

  if (live) {
    label = "Live-Ergebnis";
    note = liveMinute ? `${liveMinute}'. Minute` : "Live";
  } else if (status === "played" || status === "finished") {
    label = "Endstand";
    note = "BFV";
  } else if (status === "postponed") {
    label = "Status";
    note = "Verlegt";
  }

  return {
    available: hasResult,
    fontId: hasResult ? fontId : "",
    label,
    live,
    note,
    specialResult,
    status,
    text: hasResult ? resultText : "",
  };
};

const parseScore = (resultText, isHome) => {
  const scoreMatch = resultText.match(/(\d+):(\d+)/);

  if (!scoreMatch) {
    return null;
  }

  const homeGoals = Number(scoreMatch[1]);
  const awayGoals = Number(scoreMatch[2]);

  return {
    homeGoals,
    awayGoals,
    opponentGoals: isHome ? awayGoals : homeGoals,
    tsvGoals: isHome ? homeGoals : awayGoals,
  };
};

const buildHistoryEntry = ({ event, result }) => {
  if (!result.available || !result.text) {
    return null;
  }

  const parsedScore = parseScore(result.text, event.isHome);

  if (!parsedScore) {
    return null;
  }

  const { tsvGoals, opponentGoals } = parsedScore;
  const outcome = tsvGoals > opponentGoals ? "win" : tsvGoals < opponentGoals ? "loss" : "draw";

  return {
    competition: event.competition,
    fixtureText: buildFixtureText(event),
    isHome: event.isHome,
    league: event.league,
    opponent: event.opponent,
    outcome,
    resultText: result.text,
    start: event.start.toISOString(),
    tsvGoals,
    opponentGoals,
    uid: event.uid,
  };
};

const summarizeHistory = (entries, nextEvent) => {
  if (!entries.length) {
    return null;
  }

  const recent = entries.slice(-HISTORY_LIMIT);
  const recentThree = recent.slice(-3);
  const sameVenueRecent = recent.filter((entry) => entry.isHome === nextEvent.isHome).slice(-3);
  const wins = recent.filter((entry) => entry.outcome === "win").length;
  const draws = recent.filter((entry) => entry.outcome === "draw").length;
  const losses = recent.filter((entry) => entry.outcome === "loss").length;
  const goalsFor = recent.reduce((sum, entry) => sum + entry.tsvGoals, 0);
  const goalsAgainst = recent.reduce((sum, entry) => sum + entry.opponentGoals, 0);
  const points = recent.reduce((sum, entry) => sum + (entry.outcome === "win" ? 3 : entry.outcome === "draw" ? 1 : 0), 0);
  const sameVenuePoints = sameVenueRecent.reduce(
    (sum, entry) => sum + (entry.outcome === "win" ? 3 : entry.outcome === "draw" ? 1 : 0),
    0
  );
  const recentThreeGoals = recentThree.reduce((sum, entry) => sum + entry.tsvGoals, 0);

  return {
    entries: recent,
    goalsAgainst,
    goalsFor,
    losses,
    points,
    recentThreeGoals,
    recentThreeMatches: recentThree.length,
    sameVenueMatches: sameVenueRecent.length,
    sameVenuePoints,
    venueLabel: nextEvent.isHome ? "Heimspiele" : "Auswärtsspiele",
    wins,
    draws,
  };
};

const extractSeasonSummary = (html) => {
  const description = extractValue(html, /<meta name="description" content="([^"]+)"/);

  if (!description) {
    return null;
  }

  const positionMatch = description.match(/Platz\s+(\d+)/i);
  const goalsMatch = description.match(/Torverhältnis von\s+(\d+):(\d+)/i);
  const leagueMatch = description.match(/in der Liga\s+(.+?)\s+mit einem Torverhältnis/i);

  if (!positionMatch && !goalsMatch) {
    return null;
  }

  return {
    description,
    goalsAgainst: goalsMatch ? Number(goalsMatch[2]) : null,
    goalsFor: goalsMatch ? Number(goalsMatch[1]) : null,
    league: leagueMatch ? leagueMatch[1].trim() : "",
    position: positionMatch ? Number(positionMatch[1]) : null,
  };
};

const main = async () => {
  const icsText = await readFile(ICS_PATH, "utf8");
  const events = parseEvents(icsText);
  const nextEvent = getCurrentOrNextEvent(events);

  if (!nextEvent) {
    const emptyPayload = {
      generatedAt: new Date().toISOString(),
      match: null,
    };
    await writeFile(OUTPUT_PATH, `${JSON.stringify(emptyPayload, null, 2)}\n`);
    return;
  }

  const response = await fetch(`${BFV_MATCH_BASE}${nextEvent.uid}`);

  if (!response.ok) {
    throw new Error(`BFV match page unavailable: ${response.status}`);
  }

  const html = await response.text();
  const result = buildResultPayload({ event: nextEvent, html });
  let seasonSummary = null;
  const pastEvents = events.filter((event) => event.start.getTime() < nextEvent.start.getTime()).slice(-8);
  const historyEntries = [];

  for (const event of pastEvents) {
    try {
      const historyResponse = await fetch(`${BFV_MATCH_BASE}${event.uid}`);

      if (!historyResponse.ok) {
        continue;
      }

      const historyHtml = await historyResponse.text();
      const historyResult = buildResultPayload({ event, html: historyHtml });
      const entry = buildHistoryEntry({ event, result: historyResult });

      if (entry) {
        historyEntries.push(entry);
      }
    } catch {
      // ignore single-match history fetch failures
    }
  }

  const historySummary = summarizeHistory(historyEntries, nextEvent);

  if (!historySummary) {
    try {
      const teamResponse = await fetch(BFV_TEAM_URL);

      if (teamResponse.ok) {
        const teamHtml = await teamResponse.text();
        seasonSummary = extractSeasonSummary(teamHtml);
      }
    } catch {
      seasonSummary = null;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    match: {
      bfvUrl: `${BFV_MATCH_BASE}${nextEvent.uid}`,
      competition: nextEvent.competition,
      fixtureText: buildFixtureText(nextEvent),
      isHome: nextEvent.isHome,
      league: nextEvent.league,
      location: nextEvent.location,
      opponent: nextEvent.opponent,
      history: historySummary,
      seasonSummary,
      result,
      start: nextEvent.start.toISOString(),
      uid: nextEvent.uid,
    },
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
