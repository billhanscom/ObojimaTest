(function () {
    const storageKey = "obojimaHighContrast";

    function applyHighContrast(isEnabled) {
        document.body.classList.toggle("high-contrast", isEnabled);
        document.querySelectorAll(".contrast-toggle-button").forEach(button => {
            button.setAttribute("aria-pressed", String(isEnabled));
            button.setAttribute("aria-label", isEnabled ? "Turn off high contrast mode" : "Turn on high contrast mode");
            button.setAttribute("title", isEnabled ? "Turn off high contrast" : "Turn on high contrast");
            button.textContent = "◐ HC";
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        const isEnabled = localStorage.getItem(storageKey) === "true";
        applyHighContrast(isEnabled);

        document.querySelectorAll(".contrast-toggle-button").forEach(button => {
            button.addEventListener("click", () => {
                const nextState = !document.body.classList.contains("high-contrast");
                localStorage.setItem(storageKey, String(nextState));
                applyHighContrast(nextState);
            });
        });
    });
})();
