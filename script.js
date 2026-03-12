const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const audioToggle = document.querySelector("[data-audio-toggle]");
const clubAudio = document.querySelector("[data-club-audio]");

if (audioToggle && clubAudio) {
  const syncAudioState = () => {
    audioToggle.classList.toggle("is-playing", !clubAudio.paused);
  };

  const kickBall = () => {
    audioToggle.classList.remove("is-kicking");
    void audioToggle.offsetWidth;
    audioToggle.classList.add("is-kicking");
  };

  const tryPlayAudio = () => {
    clubAudio.play().then(syncAudioState).catch(() => {
      syncAudioState();
    });
  };

  audioToggle.addEventListener("click", () => {
    kickBall();

    if (clubAudio.paused) {
      tryPlayAudio();
    } else {
      clubAudio.pause();
      syncAudioState();
    }
  });

  clubAudio.addEventListener("play", syncAudioState);
  clubAudio.addEventListener("pause", syncAudioState);

  window.addEventListener("load", () => {
    tryPlayAudio();
  });
}

const countdownRoot = document.querySelector("[data-countdown]");

if (countdownRoot) {
  const matchNode = countdownRoot.querySelector("[data-countdown-match]");
  const dateNode = countdownRoot.querySelector("[data-countdown-date]");
  const locationNode = countdownRoot.querySelector("[data-countdown-location]");
  const timerNode = countdownRoot.querySelector("[data-countdown-timer]");
  const countdownSrc = countdownRoot.getAttribute("data-countdown-src");

  const formatDate = (date) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const parseIcsDate = (rawValue) => {
    const match = rawValue.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);

    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
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
        };
      })
      .filter((event) => event.start instanceof Date && !Number.isNaN(event.start.getTime()))
      .sort((a, b) => a.start - b.start);
  };

  const renderFallback = () => {
    if (matchNode) {
      matchNode.textContent = "Naechster Termin";
    }

    if (dateNode) {
      dateNode.textContent = "Kalender nicht verfuegbar";
    }

    if (locationNode) {
      locationNode.textContent = "Bitte Spielplan pruefen";
    }

    if (timerNode) {
      timerNode.innerHTML = "<span>Kein Countdown verfuegbar</span>";
    }
  };

  const startCountdown = (targetDate) => {
    const render = () => {
      const diff = targetDate.getTime() - Date.now();

      if (diff <= 0) {
        timerNode.innerHTML = "<span>Laeuft jetzt</span>";
        return;
      }

      const totalMinutes = Math.floor(diff / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;

      timerNode.innerHTML = `
        <span>${days} Tage</span>
        <span>${hours} Stunden</span>
        <span>${minutes} Minuten</span>
      `;
    };

    render();
    window.setInterval(render, 60000);
  };

  if (countdownSrc && matchNode && dateNode && locationNode && timerNode) {
    fetch(countdownSrc)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Countdown source unavailable");
        }

        return response.text();
      })
      .then((icsText) => {
        const nextEvent = parseEvents(icsText).find((event) => event.start.getTime() > Date.now());

        if (!nextEvent) {
          renderFallback();
          return;
        }

        matchNode.textContent = nextEvent.summary;
        dateNode.textContent = formatDate(nextEvent.start);
        locationNode.textContent = nextEvent.location;
        startCountdown(nextEvent.start);
      })
      .catch(() => {
        renderFallback();
      });
  }
}
