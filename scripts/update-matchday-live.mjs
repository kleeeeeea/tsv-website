import { readFile, writeFile } from "node:fs/promises";

const ICS_PATH = "spielplan-tsv-hainsfarth.ics";
const OUTPUT_PATH = "matchday-live.json";
const CLUB_NAME = "TSV Hainsfarth";
const BFV_MATCH_BASE = "https://www.bfv.de/ergebnisse/spiel/-/";
const ACTIVE_MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;

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

const main = async () => {
  const icsText = await readFile(ICS_PATH, "utf8");
  const nextEvent = getCurrentOrNextEvent(parseEvents(icsText));

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
