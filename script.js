const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const musicToggle = document.querySelector("[data-music-toggle]");
const musicPanel = document.querySelector("[data-music-panel]");

if (musicToggle && musicPanel) {
  musicToggle.addEventListener("click", () => {
    const isHidden = musicPanel.hasAttribute("hidden");

    if (isHidden) {
      musicPanel.removeAttribute("hidden");
    } else {
      musicPanel.setAttribute("hidden", "");
    }

    musicToggle.setAttribute("aria-expanded", String(isHidden));
  });
}
