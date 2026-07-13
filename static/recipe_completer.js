let selectedInventory = [];
let currentValuesYear = localStorage.getItem("obojimaValuesYear") || "2024";

document.addEventListener("DOMContentLoaded", () => {
    setupCompleterIngredientButtons();
    updateCompleterValuesToggleButton();
    populatePotionOptions();
    loadCompleterIngredientButtonsForCurrentYear();
});

function setupCompleterIngredientButtons() {
    document.querySelectorAll(".ingredient-button").forEach(button => {
        button.addEventListener("click", () => {
            const ingredient = button.getAttribute("data-ingredient");
            const rarityClass = button.getAttribute("data-rarity");

            button.classList.toggle("selected");
            button.classList.toggle(rarityClass);

            if (selectedInventory.includes(ingredient)) {
                selectedInventory = selectedInventory.filter(i => i !== ingredient);
            } else {
                selectedInventory.push(ingredient);
            }
        });
    });
}

function toggleCompleterValuesYear() {
    currentValuesYear = currentValuesYear === "2024" ? "2014" : "2024";
    localStorage.setItem("obojimaValuesYear", currentValuesYear);

    clearCompleterSelection();
    updateCompleterValuesToggleButton();
    loadCompleterIngredientButtonsForCurrentYear();
}

function updateCompleterValuesToggleButton() {
    document.querySelectorAll(".values-toggle-button").forEach(toggleButton => {
        toggleButton.textContent = currentValuesYear === "2024"
            ? "Use 2014 Values"
            : "Use 2024 Values";
    });
}

async function loadCompleterIngredientButtonsForCurrentYear() {
    const response = await fetch(`/ingredients-data?dataset=${currentValuesYear}`);
    if (!response.ok) {
        console.error(`Failed to load ingredient data: ${response.status}`);
        return;
    }

    const ingredients = await response.json();
    const ingredientMap = {};
    ingredients.forEach(ingredient => {
        ingredientMap[ingredient.name] = ingredient;
    });

    document.querySelectorAll(".ingredient-button").forEach(button => {
        const ingredientName = button.getAttribute("data-ingredient");
        const ingredient = ingredientMap[ingredientName];
        if (!ingredient) return;

        button.setAttribute("data-rarity", ingredient.rarity);
        button.setAttribute("data-ingredient", ingredient.name);
        const sourceMarker = ingredient.source === "Obojima: Tales from Yatamon" ? "*" : "";
        button.innerHTML = `${ingredient.name}${sourceMarker} [${ingredient.combat}-${ingredient.utility}-${ingredient.whimsy}]`;
    });
}

function populatePotionOptions() {
    const type = document.getElementById("target-potion-type").value;
    const potionSelect = document.getElementById("target-potion");
    potionSelect.innerHTML = "";

    const keyMap = {
        "Combat": "combat_names",
        "Utility": "utility_names",
        "Whimsy": "whimsy_names"
    };

    const names = window.POTION_NAMES[keyMap[type]] || {};
    Object.keys(names)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach(number => {
            const option = document.createElement("option");
            option.value = String(number);
            option.textContent = `${number}. ${names[String(number)]}`;
            potionSelect.appendChild(option);
        });
}

async function completeRecipe() {
    if (selectedInventory.length < 2) {
        alert("Please select at least two ingredients in your inventory.");
        return;
    }

    const payload = {
        ingredients: selectedInventory,
        dataset: currentValuesYear,
        region: document.getElementById("current-region").value,
        potion_type: document.getElementById("target-potion-type").value,
        potion_value: document.getElementById("target-potion").value
    };

    const response = await fetch("/complete-recipe", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        console.error(`Failed to complete recipe: ${response.status}`);
        return;
    }

    const data = await response.json();
    renderCompleterResults(data);
}

function formatCompleterIngredient(ingredient) {
    const sourceMarker = ingredient.source === "Obojima: Tales from Yatamon" ? "*" : "";
    return `${ingredient.name}${sourceMarker} [${ingredient.combat}-${ingredient.utility}-${ingredient.whimsy}]`;
}

function getUniqueRegions(results) {
    const seen = new Set();
    results.forEach(result => {
        (result.availability_regions || []).forEach(region => seen.add(region));
    });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function formatDesignation(distanceLabel, regions) {
    if (distanceLabel === "Rare Ingredient") {
        return "Rare Ingredient";
    }

    const regionCount = regions.length;
    let label = distanceLabel;

    if (distanceLabel === "Adjacent Region") {
        label = regionCount === 1 ? "Adjacent Region" : "Adjacent Regions";
    } else if (distanceLabel === "Distant Region") {
        label = regionCount === 1 ? "Distant Region" : "Distant Regions";
    } else if (distanceLabel === "Current Region") {
        label = "Current Region";
    }

    return regionCount > 0 ? `${label} (${regions.join(", ")})` : label;
}

function renderCompleterResults(data) {
    const resultsDiv = document.getElementById("completer-results");
    resultsDiv.innerHTML = "";

    const title = document.createElement("div");
    title.className = "recipe-summary";
    title.textContent = data.target_potion;
    resultsDiv.appendChild(title);

    if (data.already_complete && data.complete_recipes && data.complete_recipes.length > 0) {
        const message = document.createElement("p");
        message.className = "completer-empty";
        message.textContent = data.message || "Potion can be brewed using current inventory—no additional ingredients needed.";
        resultsDiv.appendChild(message);

        const completeGrid = document.createElement("div");
        completeGrid.className = "completion-grid";

        data.complete_recipes.forEach(recipe => {
            const card = document.createElement("div");
            card.className = "completion-card";

            const ingredientsList = recipe.owned_ingredients.map(ing => {
                const rarityClass = ing.rarity.toLowerCase();
                return `<li class="ingredient ${rarityClass}">${formatCompleterIngredient(ing)}</li>`;
            }).join("");

            card.innerHTML = `
                <h4>Current Inventory Recipe</h4>
                <p class="completion-meta"><strong>${recipe.attribute_totals}</strong></p>
                <ul class="completion-recipe-list">${ingredientsList}</ul>
            `;

            completeGrid.appendChild(card);
        });

        resultsDiv.appendChild(completeGrid);
        resultsDiv.scrollIntoView({behavior: "smooth"});
        return;
    }

    if (!data.results || data.results.length === 0) {
        const message = document.createElement("p");
        message.className = "completer-empty";
        message.textContent = data.message || "No single ingredient completes this potion from your current inventory. Try selecting different ingredients or adding to your inventory.";
        resultsDiv.appendChild(message);
        resultsDiv.scrollIntoView({behavior: "smooth"});
        return;
    }

    const tally = document.createElement("div");
    tally.className = "completer-tally";
    const completionCount = data.completion_count || 0;
    tally.textContent = `${completionCount.toLocaleString()} ${completionCount === 1 ? "Ingredient" : "Ingredients"} Found That Complete a Recipe for the Selected Potion`;
    resultsDiv.appendChild(tally);

    const bestRegions = getUniqueRegions(data.results);
    const bestDesignation = formatDesignation(data.results[0].distance_label, bestRegions);
    const intro = document.createElement("p");
    intro.className = "completer-intro";
    intro.textContent = `Best Available ${data.results.length === 1 ? "Option" : "Options"}: ${bestDesignation}`;
    resultsDiv.appendChild(intro);

    const grid = document.createElement("div");
    grid.className = "completion-grid";

    data.results.forEach(result => {
        const card = document.createElement("div");
        card.className = "completion-card";

        const ingredient = result.missing_ingredient;
        const rarityClass = ingredient.rarity.toLowerCase();
        const cardRegions = result.availability_regions || [];
        const cardDesignation = formatDesignation(result.distance_label, cardRegions);

        const ownedList = result.owned_ingredients.map(ing => {
            const ownedRarityClass = ing.rarity.toLowerCase();
            return `<li class="ingredient ${ownedRarityClass}">${formatCompleterIngredient(ing)}</li>`;
        }).join("");

        card.innerHTML = `
            <div class="completion-card-header">
                <h4>Add: <span class="ingredient ${rarityClass}">${formatCompleterIngredient(ingredient)}</span></h4>
                <p class="completion-meta"><strong>${result.attribute_totals}</strong></p>
            </div>
            <ul class="completion-recipe-list">${ownedList}<li class="ingredient ${rarityClass}">${formatCompleterIngredient(ingredient)}</li></ul>
            <p class="completion-region-footer">${cardDesignation}</p>
        `;

        grid.appendChild(card);
    });

    resultsDiv.appendChild(grid);
    resultsDiv.scrollIntoView({behavior: "smooth"});
}

function clearCompleterSelection() {
    selectedInventory = [];
    document.querySelectorAll(".ingredient-button").forEach(button => {
        button.classList.remove("selected", "common", "uncommon", "rare");
    });
    document.getElementById("completer-results").innerHTML = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
}
