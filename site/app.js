const copyButton = document.querySelector("[data-copy]");
const copyLabel = copyButton ? copyButton.querySelector(".copy-label") : null;
const copyStatus = document.getElementById("copy-status");

if (copyButton && copyLabel && copyStatus) {
  const { label, copied, fail, done } = copyButton.dataset;
  let resetTimer;

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
    } catch {
      copyStatus.textContent = fail;
      return;
    }

    copyLabel.textContent = copied;
    copyButton.dataset.state = "copied";
    copyStatus.textContent = done;

    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyLabel.textContent = label;
      delete copyButton.dataset.state;
    }, 2400);
  });
}

const osButtons = document.querySelectorAll("[data-os]");
const windowsSteps = document.getElementById("install-windows");

osButtons.forEach((button) => {
  button.addEventListener("click", () => {
    osButtons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    windowsSteps.hidden = button.dataset.os !== "windows";
  });
});

const langMenu = document.querySelector(".lang details");

if (langMenu) {
  document.addEventListener("click", (event) => {
    if (!langMenu.contains(event.target)) langMenu.open = false;
  });
  langMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    langMenu.open = false;
    langMenu.querySelector("summary").focus();
  });
}
