import { readFile, writeFile } from "node:fs/promises";

const ICS_PATH = "spielplan-tsv-hainsfarth.ics";
const OUTPUT_PATH = "matchday-live.json";
const CLUB_NAME = "TSV Hainsfarth";
const BFV_MATCH_BASE = "https://www.bfv.de/ergebnisse/spiel/-/";
const BFV_TEAM_PAGE_URL =
  "https://www.bfv.de/mannschaften/tsv-hainsfarth/016PHCS5TO000000VV0AG80NVUT1FLRU";
const ACTIVE_MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;
const USER_AGENT = "Mozilla/5.0 (compatible; TSVHainsfarthBot/1.0)";
const FINISHED_STATUSES = new Set(["acknowledged", "finished", "played"]);

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

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
};

const decodeHtmlAttribute = (value) => value.replace(/&amp;/g, "&");

const extractCustomParameterValue = (html, key) => {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escapedKey}:\\s*"([^"]+)"`));
  return match ? match[1].trim() : "";
};

const extractIcsExportUrl = (html) => {
  const absoluteMatch = html.match(
    /https:\/\/service\.bfv\.de\/rest\/icsexport\/Spielplan\?staffel=[^"'&\s]+(?:&amp;|&)id=[^"'\s]+/u
  );

  if (absoluteMatch) {
    return decodeHtmlAttribute(absoluteMatch[0]);
  }

  const relativeMatch = html.match(/\/rest\/icsexport\/Spielplan\?staffel=[^"'&\s]+(?:&amp;|&)id=[^"'\s]+/u);

  if (relativeMatch) {
    return new URL(decodeHtmlAttribute(relativeMatch[0]), "https://service.bfv.de").toString();
  }

  const staffelId = extractCustomParameterValue(html, 7);
  const clubId = extractCustomParameterValue(html, 8);

  if (staffelId && clubId) {
    const params = new URLSearchParams({
      staffel: staffelId,
      id: clubId,
    });

    return `https://service.bfv.de/rest/icsexport/Spielplan?${params.toString()}`;
  }

  throw new Error("Could not find BFV iCal export link");
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

const loadCurrentCalendar = async () => {
  const teamPageHtml = await fetchText(BFV_TEAM_PAGE_URL);
  const exportUrl = extractIcsExportUrl(teamPageHtml);
  return fetchText(exportUrl);
};

const extractValue = (html, pattern) => {
  const match = html.match(pattern);
  return match ? match[1] : "";
};

const countGoalsBySide = (html) => {
  const markers = [...html.matchAll(/Time_partialScore__xFjLz/g)];
  let homeGoals = 0;
  let awayGoals = 0;

  for (const marker of markers) {
    const markerIndex = marker.index ?? -1;
    const segment = html.slice(Math.max(0, markerIndex - 1600), markerIndex);
    const homeIndex = segment.lastIndexOf("EventList_eventHome__");
    const guestIndex = segment.lastIndexOf("EventList_eventGuest__");

    if (homeIndex === -1 && guestIndex === -1) {
      continue;
    }

    if (homeIndex > guestIndex) {
      homeGoals += 1;
    } else {
      awayGoals += 1;
    }
  }

  return {
    awayGoals,
    homeGoals,
  };
};

const buildResultPayload = ({ html, event }) => {
  const status = extractValue(html, /\\?"status\\?":\\?"([^"\\]+)\\?"/);
  const live = extractValue(html, /\\?"live\\?":(true|false)/) === "true";
  const liveMinute = extractValue(html, /\\?"liveMinute\\?":\\?"([^"\\]*)\\?"/);
  const resultText = extractValue(html, /\\?"result\\?":\{\\?"text\\?":\\?"([^"\\]*)\\?",\\?"specialResult\\?":(true|false)\}/);
  const specialResult = Boolean(
    resultText &&
      html.match(
        new RegExp(String.raw`\\?"result\\?":\{\\?"text\\?":\\?"${resultText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?",\\?"specialResult\\?":true\}`)
      )
  );
  const fontId = extractValue(html, /\\?"obfuscatedFont\\?":\\?"([^"\\]+)\\?"/);
  const { homeGoals, awayGoals } = countGoalsBySide(html);

  const sanitizedLiveMinute = liveMinute && liveMinute !== "$undefined" ? liveMinute : "";
  const hasNumericResult = live || FINISHED_STATUSES.has(status);
  const plainText = hasNumericResult ? `${homeGoals}:${awayGoals}` : "";
  const hasResult = hasNumericResult || (Boolean(resultText) && status !== "scheduled");
  let label = "BFV-Ergebnis";
  let note = "BFV";

  if (live) {
    label = "Live-Ergebnis";
    note = sanitizedLiveMinute ? `${sanitizedLiveMinute}'. Minute` : "Live";
  } else if (status === "played" || status === "finished") {
    label = "Endstand";
    note = "BFV";
  } else if (status === "acknowledged") {
    label = "Endstand";
    note = "BFV";
  } else if (status === "postponed") {
    label = "Status";
    note = "Verlegt";
  }

  return {
    available: hasResult,
    fontId: hasResult ? fontId : "",
    homeGoals,
    label,
    live,
    awayGoals,
    note,
    plainText,
    specialResult,
    status,
    text: hasResult ? resultText : "",
  };
};

const main = async () => {
  let existingIcsText = "";

  try {
    existingIcsText = await readFile(ICS_PATH, "utf8");
  } catch {
    existingIcsText = "";
  }

  let icsText = existingIcsText;

  try {
    const liveIcsText = await loadCurrentCalendar();

    if (liveIcsText.trim()) {
      icsText = liveIcsText;
    }
  } catch (error) {
    console.warn(
      `BFV-Kalender konnte nicht live aktualisiert werden, vorhandene ICS wird weiterverwendet: ${
        error?.message || error
      }`
    );
  }

  if (!icsText.trim()) {
    throw new Error("No BFV calendar data available");
  }

  if (icsText !== existingIcsText) {
    await writeFile(ICS_PATH, icsText);
  }

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
