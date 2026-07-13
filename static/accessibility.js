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


document.addEventListener("DOMContentLoaded",()=>{
 document.querySelectorAll('#results,#completer-results').forEach(r=>{r.setAttribute('aria-live','polite');});
 document.querySelectorAll('.ingredient-button').forEach(b=>{
   const rarity=b.dataset.rarity||'ingredient';
   b.setAttribute('aria-label',`Select ingredient: ${b.dataset.ingredient}. ${rarity} ingredient.`);
 });
 document.querySelectorAll('select').forEach(s=>{
   if(!s.id)return;
   s.setAttribute('aria-label', s.previousElementSibling? s.previousElementSibling.textContent.trim():s.id);
 });
});
