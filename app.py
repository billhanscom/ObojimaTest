from flask import Flask, request, jsonify, render_template
import json
from itertools import combinations
import re
from pathlib import Path

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent

# Load potion names and ingredient data from JSON files
with open(BASE_DIR / 'potion_names.json') as f:
    potion_names_data = json.load(f)

combat_names = potion_names_data["combat_names"]
utility_names = potion_names_data["utility_names"]
whimsy_names = potion_names_data["whimsy_names"]

DATASETS = {}
for dataset_name, filename in {
    '2014': 'ingredients_2014.json',
    '2024': 'ingredients_2024.json'
}.items():
    with open(BASE_DIR / filename) as f:
        DATASETS[dataset_name] = json.load(f)

DEFAULT_DATASET = '2024'


def normalize_rarity(rarity):
    rarity = str(rarity).lower()
    if rarity in ('c', 'common'):
        return 'common'
    if rarity in ('u', 'uncommon'):
        return 'uncommon'
    if rarity in ('r', 'rare'):
        return 'rare'
    return rarity


# Helper function to sort recipes numerically by potion number
def extract_number(potion_name):
    match = re.match(r"(\d+)", potion_name)
    return int(match.group(0)) if match else float('inf')  # Sort "Unknown" or non-numeric values last


def get_ingredient_data(dataset):
    return DATASETS.get(dataset, DATASETS[DEFAULT_DATASET])


def split_ingredients_by_rarity(ingredient_data):
    common_ingredients = [ing for ing in ingredient_data if normalize_rarity(ing.get('rarity')) == 'common']
    uncommon_ingredients = [ing for ing in ingredient_data if normalize_rarity(ing.get('rarity')) == 'uncommon']
    rare_ingredients = [ing for ing in ingredient_data if normalize_rarity(ing.get('rarity')) == 'rare']
    return common_ingredients, uncommon_ingredients, rare_ingredients


# Route to the main page to display the ingredient selection form
@app.route('/')
def index():
    ingredient_data = get_ingredient_data(DEFAULT_DATASET)
    common_ingredients, uncommon_ingredients, rare_ingredients = split_ingredients_by_rarity(ingredient_data)
    return render_template(
        'index.html',
        common_ingredients=common_ingredients,
        uncommon_ingredients=uncommon_ingredients,
        rare_ingredients=rare_ingredients,
        default_dataset=DEFAULT_DATASET
    )


@app.route('/ingredients-data')
def ingredients_data():
    dataset = request.args.get('dataset', DEFAULT_DATASET)
    return jsonify(get_ingredient_data(dataset))


# Calculate all possible recipes based on selected ingredients
@app.route('/get-recipes', methods=['POST'])
def get_recipes():
    payload = request.get_json() or {}
    user_ingredients = payload.get('ingredients', [])  # Get selected ingredients
    dataset = payload.get('dataset', DEFAULT_DATASET)
    ingredient_data = get_ingredient_data(dataset)

    # Filter selected ingredient details from JSON data
    selected_ingredients = [ing for ing in ingredient_data if ing['name'] in user_ingredients]

    # Calculate all possible recipes from every combination of three ingredients
    possible_recipes = {'Combat': [], 'Utility': [], 'Whimsy': []}
    for combo in combinations(selected_ingredients, 3):
        total_combat = sum([ing['combat'] for ing in combo])
        total_utility = sum([ing['utility'] for ing in combo])
        total_whimsy = sum([ing['whimsy'] for ing in combo])

        # Determine potion type(s) based on the highest scores, excluding any zero-score attributes
        recipe_types = []
        if total_combat > 0 and total_combat >= total_utility and total_combat >= total_whimsy:
            recipe_types.append(("Combat", total_combat))
        if total_utility > 0 and total_utility >= total_combat and total_utility >= total_whimsy:
            recipe_types.append(("Utility", total_utility))
        if total_whimsy > 0 and total_whimsy >= total_combat and total_whimsy >= total_utility:
            recipe_types.append(("Whimsy", total_whimsy))

        # Add recipes to the result only if a valid potion type is determined
        for potion_type, potion_value in recipe_types:
            # Fetch the appropriate potion name from the dictionary (using string for lookup)
            potion_name = ""
            if potion_type == "Combat":
                potion_name = f"{potion_value}. {combat_names.get(str(potion_value), 'No matching potion')}"
            elif potion_type == "Utility":
                potion_name = f"{potion_value}. {utility_names.get(str(potion_value), 'No matching potion')}"
            elif potion_type == "Whimsy":
                potion_name = f"{potion_value}. {whimsy_names.get(str(potion_value), 'No matching potion')}"

            recipe = {
                "potion_type": potion_name,
                "attribute_totals": f"[{total_combat}-{total_utility}-{total_whimsy}]",
                "ingredients": [
                    {
                        "name": ing["name"],
                        "rarity": normalize_rarity(ing["rarity"]),
                        "combat": ing["combat"],
                        "utility": ing["utility"],
                        "whimsy": ing["whimsy"]
                    } for ing in combo
                ]
            }
            possible_recipes[potion_type].append(recipe)

    # Sort each potion type's recipes numerically by potion number
    for potion_list in possible_recipes.values():
        potion_list.sort(key=lambda x: extract_number(x['potion_type']))

    # Return list of possible recipes as JSON
    return jsonify(possible_recipes)


if __name__ == '__main__':
    app.run(debug=True)
