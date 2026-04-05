(function () {
  const root = document.querySelector("[data-tippspiel-app]");

  if (!root) {
    return;
  }

  const config = window.tsvTippspielConfig || {};
  const setupPanel = root.querySelector("[data-tippspiel-setup]");
  const seasonNode = root.querySelector("[data-tip-season]");
  const nextTitleNode = root.querySelector("[data-tip-next-title]");
  const nextBadgeNode = root.querySelector("[data-tip-next-badge]");
  const nextDateNode = root.querySelector("[data-tip-next-date]");
  const nextCompetitionNode = root.querySelector("[data-tip-next-competition]");
  const nextLocationNode = root.querySelector("[data-tip-next-location]");
  const homeLabelNode = root.querySelector("[data-tip-home-label]");
  const awayLabelNode = root.querySelector("[data-tip-away-label]");
  const leaderboardBody = root.querySelector("[data-tip-leaderboard-body]");
  const predictionsList = root.querySelector("[data-tip-next-predictions]");
  const resultsList = root.querySelector("[data-tip-results-list]");
  const form = root.querySelector("[data-tip-form]");
  const nameInput = root.querySelector("[data-tip-name]");
  const homeInput = root.querySelector("[data-tip-home-score]");
  const awayInput = root.querySelector("[data-tip-away-score]");
  const submitButton = root.querySelector("[data-tip-submit]");
  const clearButton = root.querySelector("[data-tip-clear]");
  const feedbackNode = root.querySelector("[data-tip-feedback]");
  const clubName = config.clubName || "TSV Hainsfarth";
  const seasonLabel = config.seasonLabel || "2025/2026";
  const savedNameKey = "tsv-tippspiel-name";
  const activeMatchWindowMs = 12 * 60 * 60 * 1000;
  let supabaseClient = null;
  let selectedMatch = null;
  let nextOpenMatch = null;
  let matches = [];
  let predictions = [];

  if (seasonNode) {
    seasonNode.textContent = seasonLabel;
  }

  const formatDateTime = (value) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

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
    let opponent = fixturePart || clubName;
    let isHome = fixturePart.startsWith(`${clubName}-`);

    if (fixturePart.startsWith(`${clubName}-`)) {
      opponent = fixturePart.slice(`${clubName}-`.length);
      isHome = true;
    } else if (fixturePart.endsWith(`-${clubName}`)) {
      opponent = fixturePart.slice(0, fixturePart.length - `-${clubName}`.length);
      isHome = false;
    }

    return {
      fixture: fixturePart || clubName,
      competition,
      league,
      opponent: opponent.trim() || clubName,
      isHome,
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

        return {
          start: parseIcsDate(getField("DTSTART")),
          summary: getField("SUMMARY").replace(/\\,/g, ","),
          location: getField("LOCATION").replace(/\\,/g, ","),
          uid: getField("UID"),
        };
      })
      .map((event) => ({
        ...event,
        ...parseSummary(event.summary),
      }))
      .filter((event) => event.start instanceof Date && !Number.isNaN(event.start.getTime()))
      .sort((a, b) => a.start - b.start);
  };

  const normalizePlayerName = (value) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const getPoints = (prediction, match) => {
    if (!Number.isInteger(match.home_score) || !Number.isInteger(match.away_score)) {
      return null;
    }

    if (prediction.predicted_home_score === match.home_score && prediction.predicted_away_score === match.away_score) {
      return 3;
    }

    const predictionDiff = prediction.predicted_home_score - prediction.predicted_away_score;
    const resultDiff = match.home_score - match.away_score;

    if (predictionDiff === resultDiff) {
      return 2;
    }

    const predictionTrend = Math.sign(predictionDiff);
    const resultTrend = Math.sign(resultDiff);

    if (predictionTrend === resultTrend) {
      return 1;
    }

    return 0;
  };

  const setFeedback = (text, isError = false) => {
    if (!feedbackNode) {
      return;
    }

    feedbackNode.textContent = text;
    feedbackNode.classList.toggle("is-error", isError);
    feedbackNode.classList.toggle("is-success", !isError);
  };

  const setFormDisabled = (isDisabled) => {
    nameInput?.toggleAttribute("disabled", isDisabled);
    homeInput?.toggleAttribute("disabled", isDisabled);
    awayInput?.toggleAttribute("disabled", isDisabled);
    submitButton?.toggleAttribute("disabled", isDisabled);
    clearButton?.toggleAttribute("disabled", isDisabled);
  };

  const renderSetupState = (message) => {
    setupPanel.hidden = false;
    setFormDisabled(true);
    setFeedback(message, true);
  };

  const renderNextMatch = () => {
    if (!selectedMatch) {
      if (nextTitleNode) {
        nextTitleNode.textContent = "Aktuell kein kommendes Spiel";
      }

      if (nextBadgeNode) {
        nextBadgeNode.textContent = "Pause";
      }

      if (nextDateNode) {
        nextDateNode.textContent = "-";
      }

      if (nextCompetitionNode) {
        nextCompetitionNode.textContent = "-";
      }

      if (nextLocationNode) {
        nextLocationNode.textContent = "-";
      }

      setFormDisabled(true);
      return;
    }

    const kickoffPassed = Date.now() >= new Date(selectedMatch.starts_at).getTime();

    if (nextTitleNode) {
      nextTitleNode.textContent = `${selectedMatch.home_team} vs. ${selectedMatch.away_team}`;
    }

    if (nextBadgeNode) {
      nextBadgeNode.textContent = kickoffPassed ? "Geschlossen" : selectedMatch.is_home ? "Heimspiel" : "Auswärtsspiel";
    }

    if (nextDateNode) {
      nextDateNode.textContent = formatDateTime(selectedMatch.starts_at);
    }

    if (nextCompetitionNode) {
      nextCompetitionNode.textContent = [selectedMatch.competition, selectedMatch.league].filter(Boolean).join(" · ") || "Pflichtspiel";
    }

    if (nextLocationNode) {
      nextLocationNode.textContent = selectedMatch.location || "Ort folgt";
    }

    if (homeLabelNode) {
      homeLabelNode.textContent = selectedMatch.home_team;
    }

    if (awayLabelNode) {
      awayLabelNode.textContent = selectedMatch.away_team;
    }

    setFormDisabled(kickoffPassed || !supabaseClient || !nextOpenMatch || nextOpenMatch.id !== selectedMatch.id);
  };

  const renderNextPredictions = () => {
    if (!predictionsList) {
      return;
    }

    const nextPredictions = predictions
      .filter((entry) => entry.match_id === selectedMatch?.id)
      .sort((a, b) => a.player_name.localeCompare(b.player_name, "de"));

    if (!nextPredictions.length) {
      predictionsList.innerHTML = '<p class="tippspiel-empty">Noch keine Tipps für das angezeigte Spiel vorhanden.</p>';
      return;
    }

    predictionsList.innerHTML = nextPredictions
      .map(
        (entry) => `
          <article class="tippspiel-tip-item">
            <strong>${escapeHtml(entry.player_name)}</strong>
            <span>${entry.predicted_home_score}:${entry.predicted_away_score}</span>
          </article>
        `
      )
      .join("");
  };

  const renderLeaderboard = () => {
    if (!leaderboardBody) {
      return;
    }

    const finishedMatches = new Map(
      matches
        .filter((match) => Number.isInteger(match.home_score) && Number.isInteger(match.away_score))
        .map((match) => [match.id, match])
    );

    const board = new Map();

    predictions.forEach((prediction) => {
      const match = finishedMatches.get(prediction.match_id);

      if (!match) {
        return;
      }

      const points = getPoints(prediction, match);
      const current = board.get(prediction.player_key) || {
        playerName: prediction.player_name,
        points: 0,
        exactHits: 0,
        tips: 0,
      };

      current.playerName = prediction.player_name;
      current.points += points ?? 0;
      current.exactHits += points === 3 ? 1 : 0;
      current.tips += 1;
      board.set(prediction.player_key, current);
    });

    const ranking = Array.from(board.values()).sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      if (b.exactHits !== a.exactHits) {
        return b.exactHits - a.exactHits;
      }

      if (b.tips !== a.tips) {
        return a.tips - b.tips;
      }

      return a.playerName.localeCompare(b.playerName, "de");
    });

    if (!ranking.length) {
      const hasStoredPredictions = predictions.length > 0;
      const hasPastMatches = matches.some((match) => new Date(match.starts_at).getTime() <= Date.now());

      if (hasStoredPredictions && hasPastMatches) {
        leaderboardBody.innerHTML =
          '<tr><td colspan="5">Tipps sind gespeichert. Die Rangliste erscheint, sobald Endergebnisse in den Spieldaten hinterlegt sind.</td></tr>';
        return;
      }

      leaderboardBody.innerHTML = '<tr><td colspan="5">Sobald Ergebnisse eingetragen sind, erscheint hier die Saisonwertung.</td></tr>';
      return;
    }

    leaderboardBody.innerHTML = ranking
      .map(
        (entry, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(entry.playerName)}</td>
            <td>${entry.points}</td>
            <td>${entry.exactHits}</td>
            <td>${entry.tips}</td>
          </tr>
        `
      )
      .join("");
  };

  const renderResults = () => {
    if (!resultsList) {
      return;
    }

    const finishedMatches = matches
      .filter((match) => Number.isInteger(match.home_score) && Number.isInteger(match.away_score))
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))
      .slice(0, 8);

    if (!finishedMatches.length) {
      const hasStoredPredictions = predictions.length > 0;
      const hasPastMatches = matches.some((match) => new Date(match.starts_at).getTime() <= Date.now());

      resultsList.innerHTML = hasStoredPredictions && hasPastMatches
        ? '<p class="tippspiel-empty">Tipps sind vorhanden. Die Auswertung erscheint, sobald Endstände in den Spieldaten stehen.</p>'
        : '<p class="tippspiel-empty">Sobald Ergebnisse eingetragen sind, erscheint hier die Auswertung.</p>';
      return;
    }

    resultsList.innerHTML = finishedMatches
      .map((match) => {
        const matchPredictions = predictions.filter((entry) => entry.match_id === match.id);
        const exactCount = matchPredictions.filter((entry) => getPoints(entry, match) === 3).length;

        return `
          <article class="tippspiel-result-item">
            <div>
              <strong>${escapeHtml(match.home_team)} vs. ${escapeHtml(match.away_team)}</strong>
              <span>${formatDateTime(match.starts_at)}</span>
            </div>
            <div class="tippspiel-result-score">
              <strong>${match.home_score}:${match.away_score}</strong>
              <span>${exactCount}x exakt</span>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const hydrateSavedNameTip = () => {
    if (!selectedMatch || !nameInput || !homeInput || !awayInput) {
      return;
    }

    const savedName = window.localStorage.getItem(savedNameKey) || "";
    const playerKey = normalizePlayerName(savedName);

    if (!savedName || !playerKey) {
      return;
    }

    nameInput.value = savedName;

    const existingPrediction = predictions.find(
      (entry) => entry.match_id === selectedMatch.id && entry.player_key === playerKey
    );

    if (existingPrediction) {
      homeInput.value = String(existingPrediction.predicted_home_score);
      awayInput.value = String(existingPrediction.predicted_away_score);
      setFeedback(`Dein gespeicherter Tipp für dieses Spiel: ${existingPrediction.predicted_home_score}:${existingPrediction.predicted_away_score}.`);
    }
  };

  const fetchMatchesAndPredictions = async () => {
    const { data: matchRows, error: matchError } = await supabaseClient
      .from("tippspiel_matches")
      .select("*")
      .eq("season", seasonLabel)
      .order("starts_at", { ascending: true });

    if (matchError) {
      throw matchError;
    }

    matches = matchRows || [];
    const now = Date.now();
    const liveWindowMatch =
      matches.find((match) => {
        const startsAt = new Date(match.starts_at).getTime();
        return now >= startsAt && now <= startsAt + activeMatchWindowMs;
      }) || null;
    const upcomingMatch = matches.find((match) => new Date(match.starts_at).getTime() > now) || null;
    const latestPastMatch =
      [...matches]
        .filter((match) => new Date(match.starts_at).getTime() <= now)
        .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0] || null;

    nextOpenMatch = upcomingMatch;
    selectedMatch = liveWindowMatch || upcomingMatch || latestPastMatch;

    const matchIds = matches.map((match) => match.id);

    if (!matchIds.length) {
      predictions = [];
      return;
    }

    const { data: predictionRows, error: predictionError } = await supabaseClient
      .from("tippspiel_predictions")
      .select("*")
      .in("match_id", matchIds);

    if (predictionError) {
      throw predictionError;
    }

    predictions = predictionRows || [];
  };

  const seedMatchesFromCalendar = async () => {
    const response = await fetch(`spielplan-tsv-hainsfarth.ics?t=${Date.now()}`, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Spielplan konnte nicht geladen werden.");
    }

    const icsText = await response.text();
    const rows = parseEvents(icsText).map((event) => ({
      match_uid: event.uid || `${event.start.toISOString()}-${event.opponent}`,
      season: seasonLabel,
      starts_at: event.start.toISOString(),
      competition: event.competition || null,
      league: event.league || null,
      is_home: event.isHome,
      opponent: event.opponent,
      location: event.location || null,
      home_team: event.isHome ? clubName : event.opponent,
      away_team: event.isHome ? event.opponent : clubName,
    }));

    if (!rows.length) {
      return;
    }

    const { error } = await supabaseClient
      .from("tippspiel_matches")
      .upsert(rows, { onConflict: "match_uid" });

    if (error) {
      throw error;
    }
  };

  const refreshBoard = async () => {
    await fetchMatchesAndPredictions();
    renderNextMatch();
    renderNextPredictions();
    renderLeaderboard();
    renderResults();
    hydrateSavedNameTip();
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabaseClient || !selectedMatch || !nextOpenMatch || selectedMatch.id !== nextOpenMatch.id) {
      setFeedback("Das Tippspiel ist gerade noch nicht bereit.", true);
      return;
    }

    const playerName = nameInput?.value?.replace(/\s+/g, " ").trim() || "";
    const playerKey = normalizePlayerName(playerName);
    const homeScore = Math.max(0, Math.min(20, Number.parseInt(homeInput?.value || "0", 10) || 0));
    const awayScore = Math.max(0, Math.min(20, Number.parseInt(awayInput?.value || "0", 10) || 0));

    if (playerName.length < 2) {
      setFeedback("Bitte gib einen Namen mit mindestens 2 Zeichen ein.", true);
      return;
    }

    if (Date.now() >= new Date(nextOpenMatch.starts_at).getTime()) {
      setFeedback("Der Anpfiff ist erreicht. Für dieses Spiel ist kein neuer Tipp mehr möglich.", true);
      renderNextMatch();
      return;
    }

    submitButton?.toggleAttribute("disabled", true);

    try {
      const { error } = await supabaseClient.from("tippspiel_predictions").upsert(
        {
          match_id: nextOpenMatch.id,
          player_name: playerName,
          player_key: playerKey,
          predicted_home_score: homeScore,
          predicted_away_score: awayScore,
        },
        { onConflict: "match_id,player_key" }
      );

      if (error) {
        throw error;
      }

      window.localStorage.setItem(savedNameKey, playerName);
      setFeedback(`Tipp gespeichert: ${homeScore}:${awayScore} für ${playerName}.`);
      await refreshBoard();
    } catch (error) {
      setFeedback("Dein Tipp konnte gerade nicht gespeichert werden.", true);
    } finally {
      submitButton?.toggleAttribute("disabled", false);
    }
  });

  clearButton?.addEventListener("click", () => {
    if (homeInput) {
      homeInput.value = "0";
    }

    if (awayInput) {
      awayInput.value = "0";
    }

    setFeedback("Felder zurückgesetzt.");
  });

  const initialize = async () => {
    const supabaseUrl = config.supabaseUrl?.trim();
    const supabaseAnonKey = config.supabaseAnonKey?.trim();

    if (!supabaseUrl || !supabaseAnonKey || !window.supabase?.createClient) {
      renderSetupState("Supabase ist noch nicht verbunden. Sobald `tippspiel-config.js` gepflegt ist, startet hier das zentrale Tippspiel.");
      return;
    }

    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
      },
    });

    setupPanel.hidden = true;

    try {
      await seedMatchesFromCalendar();
      await refreshBoard();

      if (!selectedMatch) {
        setFeedback("Aktuell ist kein kommendes Spiel im Kalender hinterlegt.");
      } else {
        setFeedback("Tippspiel bereit. Dein Tipp landet direkt in der gemeinsamen Rangliste.");
      }
    } catch (error) {
      renderSetupState("Die Verbindung zum Tippspiel konnte nicht aufgebaut werden. Prüfe Supabase-Konfiguration und Tabellen.");
    }
  };

  initialize();
})();
