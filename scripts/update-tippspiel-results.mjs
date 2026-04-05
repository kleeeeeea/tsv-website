const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || "https://yarlxyfkzhlcfkyiwtzp.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const BFV_MATCH_BASE = "https://www.bfv.de/ergebnisse/spiel/-/";
const FINISHED_STATUSES = new Set(["acknowledged", "finished", "played"]);
const GOAL_MARKER = "Time_partialScore__xFjLz";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt. Fuer sichere Schreibzugriffe wird der Service-Role-Key benoetigt.");
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

const extractValue = (html, pattern) => {
  const match = html.match(pattern);
  return match ? match[1] : "";
};

const fetchMatches = async () => {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/tippspiel_matches?select=id,match_uid,starts_at,home_score,away_score&order=starts_at.asc`,
    {
      headers: supabaseHeaders,
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase matches fetch failed: ${response.status}`);
  }

  return response.json();
};

const fetchMatchHtml = async (matchUid) => {
  const response = await fetch(`${BFV_MATCH_BASE}${matchUid}`);

  if (!response.ok) {
    throw new Error(`BFV match page unavailable for ${matchUid}: ${response.status}`);
  }

  return response.text();
};

const countGoalsBySide = (html) => {
  const markers = [...html.matchAll(new RegExp(GOAL_MARKER, "g"))];
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

const parseFinishedResult = (html) => {
  const status = extractValue(html, /\\?"status\\?":\\?"([^"\\]+)\\?"/);

  if (!FINISHED_STATUSES.has(status)) {
    return null;
  }

  const { homeGoals, awayGoals } = countGoalsBySide(html);
  return {
    awayScore: awayGoals,
    homeScore: homeGoals,
    status,
  };
};

const updateMatchResult = async ({ matchUid, homeScore, awayScore }) => {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/tippspiel_matches?match_uid=eq.${encodeURIComponent(matchUid)}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        home_score: homeScore,
        away_score: awayScore,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase match update failed for ${matchUid}: ${response.status}`);
  }
};

const main = async () => {
  const matches = await fetchMatches();
  const now = Date.now();
  let updatedMatches = 0;

  for (const match of matches) {
    if (!match?.match_uid || !match?.starts_at) {
      continue;
    }

    const startsAt = Date.parse(match.starts_at);

    if (Number.isNaN(startsAt) || startsAt > now) {
      continue;
    }

    const html = await fetchMatchHtml(match.match_uid);
    const result = parseFinishedResult(html);

    if (!result) {
      continue;
    }

    const unchanged =
      match.home_score === result.homeScore && match.away_score === result.awayScore;

    if (unchanged) {
      continue;
    }

    await updateMatchResult({
      awayScore: result.awayScore,
      homeScore: result.homeScore,
      matchUid: match.match_uid,
    });

    updatedMatches += 1;
    console.log(
      `Updated ${match.match_uid} to ${result.homeScore}:${result.awayScore} (${result.status}).`
    );
  }

  console.log(`Tippspiel result sync finished. Updated matches: ${updatedMatches}.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
