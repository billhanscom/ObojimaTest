let selectedIngredients = [];
let currentValuesYear = localStorage.getItem("obojimaValuesYear") || "2024";

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
        });
    });
}

function toggleValuesYear() {
    currentValuesYear = currentValuesYear === "2024" ? "2014" : "2024";
    localStorage.setItem("obojimaValuesYear", currentValuesYear);

    clearSelection();
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
        button.innerHTML = `${ingredient.name} [${ingredient.combat}-${ingredient.utility}-${ingredient.whimsy}]`;
    });
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

                    return `<li class="ingredient ${rarityClass}">
                        ${ing.name} [${ing.combat}-${ing.utility}-${ing.whimsy}]
                    </li>`;
                }).join('');

                return `<h4>${recipe.potion_type} ${recipe.attribute_totals}</h4><ul>${ingredientsList}</ul>`;
            }).join('');
        } else {
            column.innerHTML += '<p>No recipes found</p>';
        }

        resultsDiv.appendChild(column);
    });

    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

function clearSelection() {
    selectedIngredients = [];

    document.querySelectorAll(".ingredient-button").forEach(button => {
        button.classList.remove("selected", "common", "uncommon", "rare");
    });

    document.getElementById("results").innerHTML = '';
    window.scrollTo({ top: 0, behavior: "smooth" });
}
