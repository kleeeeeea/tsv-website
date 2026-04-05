(function () {
  const root = document.querySelector("[data-tippspiel-app]");

  if (!root) {
    return;
  }

  const config = window.tsvTippspielConfig || {};
  const setupPanel = root.querySelector("[data-tippspiel-setup]");
  const authPanel = root.querySelector("[data-tip-auth-panel]");
  const authStateNode = root.querySelector("[data-tip-auth-state]");
  const authEmailNode = root.querySelector("[data-tip-auth-email]");
  const authForm = root.querySelector("[data-tip-auth-form]");
  const authEmailInput = root.querySelector("[data-tip-auth-email-input]");
  const authSubmitButton = root.querySelector("[data-tip-auth-submit]");
  const authFeedbackNode = root.querySelector("[data-tip-auth-feedback]");
  const logoutButton = root.querySelector("[data-tip-auth-logout]");
  const profileForm = root.querySelector("[data-tip-profile-form]");
  const profileInput = root.querySelector("[data-tip-profile-name]");
  const profileSubmitButton = root.querySelector("[data-tip-profile-submit]");
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
  const activeMatchWindowMs = 12 * 60 * 60 * 1000;
  let supabaseClient = null;
  let currentSession = null;
  let currentProfile = null;
  let selectedMatch = null;
  let nextOpenMatch = null;
  let matches = [];
  let predictions = [];

  if (seasonNode) {
    seasonNode.textContent = seasonLabel;
  }

  if (nameInput) {
    nameInput.readOnly = true;
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

    if (Math.sign(predictionDiff) === Math.sign(resultDiff)) {
      return 1;
    }

    return 0;
  };

  const setTipFeedback = (text, isError = false) => {
    if (!feedbackNode) {
      return;
    }

    feedbackNode.textContent = text;
    feedbackNode.classList.toggle("is-error", isError);
    feedbackNode.classList.toggle("is-success", !isError);
  };

  const setAuthFeedback = (text, isError = false) => {
    if (!authFeedbackNode) {
      return;
    }

    authFeedbackNode.textContent = text;
    authFeedbackNode.classList.toggle("is-error", isError);
    authFeedbackNode.classList.toggle("is-success", !isError);
  };

  const setFormDisabled = (isDisabled) => {
    homeInput?.toggleAttribute("disabled", isDisabled);
    awayInput?.toggleAttribute("disabled", isDisabled);
    submitButton?.toggleAttribute("disabled", isDisabled);
    clearButton?.toggleAttribute("disabled", isDisabled);
  };

  const setDisplayedPlayerName = () => {
    if (!nameInput) {
      return;
    }

    if (currentProfile?.display_name) {
      nameInput.value = currentProfile.display_name;
      nameInput.placeholder = currentProfile.display_name;
      return;
    }

    nameInput.value = "";
    nameInput.placeholder = currentSession ? "Lege erst deinen Anzeigenamen fest" : "Bitte zuerst einloggen";
  };

  const renderSetupState = (message) => {
    setupPanel.hidden = false;
    authPanel?.setAttribute("hidden", "");
    setDisplayedPlayerName();
    setFormDisabled(true);
    setTipFeedback(message, true);
  };

  const renderAuthState = () => {
    if (authPanel) {
      authPanel.hidden = false;
    }

    if (authStateNode) {
      authStateNode.textContent = currentSession ? "Dein Account" : "Login erforderlich";
    }

    if (authEmailNode) {
      authEmailNode.textContent = currentSession?.user?.email || "Nur eingeloggte Nutzer koennen fuer sich selbst tippen.";
    }

    authForm?.toggleAttribute("hidden", Boolean(currentSession));
    logoutButton?.toggleAttribute("hidden", !currentSession);

    const needsProfile = Boolean(currentSession) && !currentProfile;
    profileForm?.toggleAttribute("hidden", !currentSession);

    if (profileInput) {
      profileInput.value = currentProfile?.display_name || "";
      profileInput.placeholder = needsProfile ? "Dein Name in der Rangliste" : "Anzeigename anpassen";
    }

    if (!currentSession) {
      setAuthFeedback("Logge dich per E-Mail-Link ein. Danach kannst nur du selbst deinen Tipp speichern.");
      return;
    }

    if (needsProfile) {
      setAuthFeedback("Lege zuerst deinen Anzeigenamen fest. Unter diesem Namen erscheint dein Tipp in der Rangliste.");
      return;
    }

    setAuthFeedback("Dein Account ist aktiv. Du kannst nur fuer dein eigenes Konto tippen.");
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
    const canTip =
      Boolean(currentSession) &&
      Boolean(currentProfile) &&
      Boolean(nextOpenMatch) &&
      nextOpenMatch.id === selectedMatch.id &&
      !kickoffPassed;

    if (nextTitleNode) {
      nextTitleNode.textContent = `${selectedMatch.home_team} vs. ${selectedMatch.away_team}`;
    }

    if (nextBadgeNode) {
      nextBadgeNode.textContent = kickoffPassed ? "Geschlossen" : selectedMatch.is_home ? "Heimspiel" : "Auswaertsspiel";
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

    setFormDisabled(!canTip);
  };

  const renderNextPredictions = () => {
    if (!predictionsList) {
      return;
    }

    const nextPredictions = predictions
      .filter((entry) => entry.match_id === selectedMatch?.id)
      .sort((a, b) => a.player_name.localeCompare(b.player_name, "de"));

    if (!nextPredictions.length) {
      predictionsList.innerHTML = '<p class="tippspiel-empty">Noch keine Tipps fuer das angezeigte Spiel vorhanden.</p>';
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
        ? '<p class="tippspiel-empty">Tipps sind vorhanden. Die Auswertung erscheint, sobald Endstaende in den Spieldaten stehen.</p>'
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

  const hydrateUserPrediction = () => {
    setDisplayedPlayerName();

    if (!selectedMatch || !homeInput || !awayInput || !currentProfile) {
      return;
    }

    const existingPrediction = predictions.find(
      (entry) =>
        entry.match_id === selectedMatch.id &&
        (entry.user_id === currentSession?.user?.id || entry.player_key === currentProfile.display_name_key)
    );

    if (!existingPrediction) {
      return;
    }

    homeInput.value = String(existingPrediction.predicted_home_score);
    awayInput.value = String(existingPrediction.predicted_away_score);
    setTipFeedback(
      `Dein gespeicherter Tipp fuer dieses Spiel: ${existingPrediction.predicted_home_score}:${existingPrediction.predicted_away_score}.`
    );
  };

  const fetchCurrentProfile = async () => {
    if (!currentSession) {
      currentProfile = null;
      return;
    }

    const { data, error } = await supabaseClient
      .from("tippspiel_players")
      .select("*")
      .eq("user_id", currentSession.user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    currentProfile = data || null;
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

  const refreshBoard = async () => {
    await fetchMatchesAndPredictions();
    renderNextMatch();
    renderNextPredictions();
    renderLeaderboard();
    renderResults();
    hydrateUserPrediction();
  };

  const updateTipFeedbackForState = () => {
    if (!selectedMatch) {
      setTipFeedback("Aktuell ist kein kommendes Spiel im Kalender hinterlegt.");
      return;
    }

    if (!currentSession) {
      setTipFeedback("Bitte logge dich ein. Dann kannst nur du selbst deinen Tipp speichern.", true);
      return;
    }

    if (!currentProfile) {
      setTipFeedback("Bitte lege zuerst deinen Anzeigenamen fest.", true);
      return;
    }

    if (!nextOpenMatch || selectedMatch.id !== nextOpenMatch.id) {
      setTipFeedback("Das angezeigte Spiel ist bereits geschlossen.");
      return;
    }

    if (Date.now() >= new Date(nextOpenMatch.starts_at).getTime()) {
      setTipFeedback("Der Anpfiff ist erreicht. Fuer dieses Spiel ist kein neuer Tipp mehr moeglich.");
      return;
    }

    setTipFeedback("Tippspiel bereit. Dein Tipp wird deinem Account zugeordnet und kann nicht fuer andere Namen gespeichert werden.");
  };

  const applySessionState = async (session) => {
    currentSession = session;
    await fetchCurrentProfile();
    renderAuthState();
    renderNextMatch();
    hydrateUserPrediction();
    updateTipFeedbackForState();
  };

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabaseClient) {
      return;
    }

    const email = authEmailInput?.value?.trim() || "";

    if (!email || !email.includes("@")) {
      setAuthFeedback("Bitte gib eine gueltige E-Mail-Adresse ein.", true);
      return;
    }

    authSubmitButton?.toggleAttribute("disabled", true);

    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.href.split("#")[0],
          shouldCreateUser: true,
        },
      });

      if (error) {
        throw error;
      }

      setAuthFeedback("Der Login-Link wurde verschickt. Oeffne ihn in deinem Postfach, dann bist du eingeloggt.");
    } catch (error) {
      setAuthFeedback("Der Login-Link konnte gerade nicht verschickt werden.", true);
    } finally {
      authSubmitButton?.toggleAttribute("disabled", false);
    }
  });

  logoutButton?.addEventListener("click", async () => {
    if (!supabaseClient) {
      return;
    }

    try {
      await supabaseClient.auth.signOut();
      await applySessionState(null);
    } catch (error) {
      setAuthFeedback("Abmelden hat gerade nicht funktioniert.", true);
    }
  });

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabaseClient || !currentSession) {
      return;
    }

    const displayName = profileInput?.value?.replace(/\s+/g, " ").trim() || "";

    if (displayName.length < 2) {
      setAuthFeedback("Bitte waehle einen Anzeigenamen mit mindestens 2 Zeichen.", true);
      return;
    }

    profileSubmitButton?.toggleAttribute("disabled", true);

    try {
      const { error } = await supabaseClient.from("tippspiel_players").upsert(
        {
          user_id: currentSession.user.id,
          display_name: displayName,
        },
        { onConflict: "user_id" }
      );

      if (error) {
        throw error;
      }

      await fetchCurrentProfile();
      renderAuthState();
      renderNextMatch();
      hydrateUserPrediction();
      updateTipFeedbackForState();
      setAuthFeedback("Anzeigename gespeichert. Unter diesem Namen erscheint dein Tipp.");
    } catch (error) {
      setAuthFeedback("Der Anzeigename konnte nicht gespeichert werden. Vielleicht ist er schon vergeben.", true);
    } finally {
      profileSubmitButton?.toggleAttribute("disabled", false);
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabaseClient || !currentSession || !currentProfile) {
      setTipFeedback("Bitte logge dich ein und lege deinen Anzeigenamen fest.", true);
      return;
    }

    if (!selectedMatch || !nextOpenMatch || selectedMatch.id !== nextOpenMatch.id) {
      setTipFeedback("Das Tippspiel ist gerade fuer dieses Spiel nicht offen.", true);
      return;
    }

    const homeScore = Math.max(0, Math.min(20, Number.parseInt(homeInput?.value || "0", 10) || 0));
    const awayScore = Math.max(0, Math.min(20, Number.parseInt(awayInput?.value || "0", 10) || 0));

    if (Date.now() >= new Date(nextOpenMatch.starts_at).getTime()) {
      setTipFeedback("Der Anpfiff ist erreicht. Fuer dieses Spiel ist kein neuer Tipp mehr moeglich.", true);
      renderNextMatch();
      return;
    }

    submitButton?.toggleAttribute("disabled", true);

    try {
      const { error } = await supabaseClient.from("tippspiel_predictions").upsert(
        {
          match_id: nextOpenMatch.id,
          user_id: currentSession.user.id,
          player_name: currentProfile.display_name,
          player_key: currentProfile.display_name_key || normalizePlayerName(currentProfile.display_name),
          predicted_home_score: homeScore,
          predicted_away_score: awayScore,
        },
        { onConflict: "match_id,user_id" }
      );

      if (error) {
        throw error;
      }

      setTipFeedback(`Tipp gespeichert: ${homeScore}:${awayScore} fuer ${currentProfile.display_name}.`);
      await refreshBoard();
    } catch (error) {
      setTipFeedback("Dein Tipp konnte gerade nicht gespeichert werden.", true);
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

    setTipFeedback("Felder zurueckgesetzt.");
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
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    setupPanel.hidden = true;

    try {
      await refreshBoard();
      const {
        data: { session },
        error: sessionError,
      } = await supabaseClient.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      await applySessionState(session);

      supabaseClient.auth.onAuthStateChange((_event, sessionValue) => {
        void applySessionState(sessionValue);
      });
    } catch (error) {
      renderSetupState(
        "Die Verbindung zum Tippspiel konnte nicht aufgebaut werden. Pruefe Supabase-Konfiguration, Auth-Einstellungen und Tabellen."
      );
    }
  };

  initialize();
})();
