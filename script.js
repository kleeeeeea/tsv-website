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

  const tryPlayAudio = () => {
    clubAudio.play().then(syncAudioState).catch(() => {
      syncAudioState();
    });
  };

  audioToggle.addEventListener("click", () => {
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
