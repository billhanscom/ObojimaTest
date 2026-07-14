const OBOJIMA_INVENTORY_STORAGE_KEY = "obojimaIngredientInventory";
let selectedIngredients = loadStoredInventory();
let currentValuesYear = localStorage.getItem("obojimaValuesYear") || "2024";

function loadStoredInventory() {
    try {
        const stored = JSON.parse(localStorage.getItem(OBOJIMA_INVENTORY_STORAGE_KEY) || "[]");
        return Array.isArray(stored) ? stored : [];
    } catch (error) {
        console.warn("Unable to load stored inventory.", error);
        return [];
    }
}

function saveStoredInventory() {
    localStorage.setItem(OBOJIMA_INVENTORY_STORAGE_KEY, JSON.stringify(selectedIngredients));
}

function normalizeInventoryList(items) {
    if (!Array.isArray(items)) return [];
    return Array.from(new Set(items.filter(item => typeof item === "string" && item.trim()).map(item => item.trim())));
}

function applyStoredInventoryToButtons() {
    document.querySelectorAll(".ingredient-button").forEach(button => {
        const ingredient = button.getAttribute("data-ingredient");
        const rarityClass = button.getAttribute("data-rarity");
        const isSelected = selectedIngredients.includes(ingredient);

        button.classList.toggle("selected", isSelected);
        button.classList.toggle("common", isSelected && rarityClass === "common");
        button.classList.toggle("uncommon", isSelected && rarityClass === "uncommon");
        button.classList.toggle("rare", isSelected && rarityClass === "rare");
    });
}

// Toggle selection for ingredient buttons
document.addEventListener("DOMContentLoaded", () => {
    setupIngredientButtons();
    updateValuesToggleButton();
    loadIngredientButtonsForCurrentYear();
});

function setupIngredientButtons() {
    document.querySelectorAll(".ingredient-button").forEach(button => {
        button.addEventListener("click", () => {
            const ingredient = button.getAttribute("data-ingredient");
            const rarityClass = button.getAttribute("data-rarity");

            button.classList.toggle("selected");
            button.classList.toggle(rarityClass);

            if (selectedIngredients.includes(ingredient)) {
                selectedIngredients = selectedIngredients.filter(i => i !== ingredient);
            } else {
                selectedIngredients.push(ingredient);
            }

            selectedIngredients = normalizeInventoryList(selectedIngredients);
            saveStoredInventory();
        });
    });
}

function toggleValuesYear() {
    currentValuesYear = currentValuesYear === "2024" ? "2014" : "2024";
    localStorage.setItem("obojimaValuesYear", currentValuesYear);

    updateValuesToggleButton();
    loadIngredientButtonsForCurrentYear();
}

function updateValuesToggleButton() {
    document.querySelectorAll(".values-toggle-button").forEach(toggleButton => {
        toggleButton.textContent = currentValuesYear === "2024"
            ? "Use 2014 Values"
            : "Use 2024 Values";
    });
}

async function loadIngredientButtonsForCurrentYear() {
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

        if (!ingredient) {
            console.warn(`No ${currentValuesYear} ingredient data found for: ${ingredientName}`);
            return;
        }

        button.setAttribute("data-rarity", ingredient.rarity);
        button.setAttribute("data-ingredient", ingredient.name);
        const sourceMarker = ingredient.source === "Obojima: Tales from Yatamon" ? "*" : "";
        button.innerHTML = `${ingredient.name}${sourceMarker} [${ingredient.combat}-${ingredient.utility}-${ingredient.whimsy}]`;
    });

    selectedIngredients = normalizeInventoryList(selectedIngredients);
    saveStoredInventory();
    applyStoredInventoryToButtons();
}


function formatIngredientName(ingredient) {
    const sourceMarker = ingredient.source === "Obojima: Tales from Yatamon" ? "*" : "";
    return `${ingredient.name}${sourceMarker} [${ingredient.combat}-${ingredient.utility}-${ingredient.whimsy}]`;
}

async function findRecipes() {
    if (selectedIngredients.length < 3) {
        alert("Oops! Please select at least three ingredients.");
        return;
    }

    const response = await fetch('/get-recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ingredients: selectedIngredients,
            dataset: currentValuesYear
        })
    });

    if (!response.ok) {
        console.error(`Failed to get recipes: ${response.status}`);
        return;
    }

    const recipes = await response.json();
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    // Add summary above the recipe columns
    let recipeCount = 0;
    let potionNames = new Set();

    ["Combat", "Utility", "Whimsy"].forEach(type => {
        if (recipes[type]) {
            recipeCount += recipes[type].length;
            recipes[type].forEach(r => potionNames.add(r.potion_type));
        }
    });

    const summary = document.createElement("div");
    summary.className = "recipe-summary";
    summary.textContent =
        `${recipeCount.toLocaleString()} Recipes Found for ${potionNames.size.toLocaleString()} Potions`;

    resultsDiv.appendChild(summary);


    const columnHeaders = {
        "Combat": "Combat Potions",
        "Utility": "Utility Potions",
        "Whimsy": "Whimsy Potions"
    };

    ["Combat", "Utility", "Whimsy"].forEach(type => {
        const column = document.createElement('div');
        column.classList.add('recipe-column');
        column.innerHTML = `<h3>${columnHeaders[type]}</h3>`;

        if (recipes[type] && recipes[type].length > 0) {
            column.innerHTML += recipes[type].map(recipe => {
                const ingredientsList = recipe.ingredients.map(ing => {
                    const rarityClass = ing.rarity.toLowerCase();

                    return `<li class="ingredient ${rarityClass}">${formatIngredientName(ing)}</li>`;
                }).join('');

                return `<div class="recipe-card completion-card"><h4>${recipe.potion_type} ${recipe.attribute_totals}</h4><ul class="completion-recipe-list">${ingredientsList}</ul></div>`;
            }).join('');
        } else {
            column.innerHTML += '<p>No recipes found</p>';
        }

        resultsDiv.appendChild(column);
    });

    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

function clearSelection() {
    const confirmed = window.confirm("Clear your entire saved inventory? This cannot be undone.");
    if (!confirmed) return;

    selectedIngredients = [];
    saveStoredInventory();

    document.querySelectorAll(".ingredient-button").forEach(button => {
        button.classList.remove("selected", "common", "uncommon", "rare");
    });

    document.getElementById("results").innerHTML = '';
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function exportInventory() {
    const payload = {
        app: "Obojima Potion Almanac",
        version: 1,
        dataset: currentValuesYear,
        exportedAt: new Date().toISOString(),
        ingredients: normalizeInventoryList(selectedIngredients)
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "obojima-inventory.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function importInventory() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";

    input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                const ingredients = Array.isArray(parsed) ? parsed : parsed.ingredients;
                selectedIngredients = normalizeInventoryList(ingredients);
                saveStoredInventory();
                applyStoredInventoryToButtons();
                document.getElementById("results").innerHTML = '';
            } catch (error) {
                alert("Sorry, that inventory file could not be loaded.");
                console.error("Unable to import inventory.", error);
            }
        };
        reader.readAsText(file);
    });

    input.click();
}
