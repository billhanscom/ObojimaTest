from flask import Flask, request, jsonify, render_template
import json
from itertools import combinations
import re
from pathlib import Path

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent

# Load potion names and ingredient data from JSON files
with open(BASE_DIR / 'potion_names.json', encoding='utf-8') as f:
    potion_names_data = json.load(f)

combat_names = potion_names_data["combat_names"]
utility_names = potion_names_data["utility_names"]
whimsy_names = potion_names_data["whimsy_names"]

DATASETS = {}
for dataset_name, filename in {
    '2014': 'ingredients_2014.json',
    '2024': 'ingredients_2024.json'
}.items():
    with open(BASE_DIR / filename, encoding='utf-8') as f:
        DATASETS[dataset_name] = json.load(f)

DEFAULT_DATASET = '2024'


def normalize_dataset(value):
    value = str(value or DEFAULT_DATASET)
    return value if value in DATASETS else DEFAULT_DATASET


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
    return int(match.group(0)) if match else float('inf')


def get_ingredient_data(dataset):
    return DATASETS[normalize_dataset(dataset)]


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
    # Supports both names so older JS and newer JS both work.
    dataset = request.args.get('dataset') or request.args.get('year') or DEFAULT_DATASET
    return jsonify(get_ingredient_data(dataset))


# Calculate all possible recipes based on selected ingredients
@app.route('/get-recipes', methods=['POST'])
def get_recipes():
    payload = request.get_json() or {}
    user_ingredients = payload.get('ingredients', [])
    # Supports both names so older JS and newer JS both work.
    dataset = payload.get('dataset') or payload.get('year') or DEFAULT_DATASET
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
            if potion_type == "Combat":
                potion_name = f"{potion_value}. {combat_names.get(str(potion_value), 'No matching potion')}"
            elif potion_type == "Utility":
                potion_name = f"{potion_value}. {utility_names.get(str(potion_value), 'No matching potion')}"
            else:
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

    return jsonify(possible_recipes)



REGIONS = [
    "Gift of Shuritashi",
    "Land of Hot Water",
    "Mount Arbora",
    "Gale Fields",
    "Coastal Highlands",
    "Brackwater Wetlands",
    "The Shallows"
]

REGION_ADJACENCIES = {
    "Gift of Shuritashi": ["Land of Hot Water", "Mount Arbora", "Coastal Highlands", "Gale Fields", "The Shallows"],
    "Land of Hot Water": ["Gift of Shuritashi", "Mount Arbora", "Brackwater Wetlands", "The Shallows"],
    "Mount Arbora": ["Gift of Shuritashi", "Gale Fields", "Brackwater Wetlands", "Land of Hot Water"],
    "Gale Fields": ["Gift of Shuritashi", "Brackwater Wetlands", "Coastal Highlands", "Mount Arbora"],
    "Coastal Highlands": ["Gale Fields", "Gift of Shuritashi", "Brackwater Wetlands", "The Shallows"],
    "Brackwater Wetlands": ["Land of Hot Water", "Mount Arbora", "Coastal Highlands", "Gale Fields", "The Shallows"],
    "The Shallows": ["Land of Hot Water", "Brackwater Wetlands", "Coastal Highlands", "Gift of Shuritashi"]
}


def get_potion_display_name(potion_type, potion_value):
    potion_value = str(potion_value)
    if potion_type == "Combat":
        return f"{potion_value}. {combat_names.get(potion_value, 'No matching potion')}"
    if potion_type == "Utility":
        return f"{potion_value}. {utility_names.get(potion_value, 'No matching potion')}"
    return f"{potion_value}. {whimsy_names.get(potion_value, 'No matching potion')}"


def ingredient_distance_label(ingredient, current_region):
    rarity = normalize_rarity(ingredient.get("rarity"))
    regions = ingredient.get("regions", [])

    if rarity == "rare":
        return 0, "Rare ingredient (available anywhere)", []

    if current_region in regions:
        return 0, "Local", [current_region]

    nearby_regions = [region for region in regions if region in REGION_ADJACENCIES.get(current_region, [])]
    if nearby_regions:
        return 1, "Adjacent region", nearby_regions

    if regions:
        return 2, "Distant region", regions

    return 3, "Unknown availability", []


@app.route('/recipe-completer')
def recipe_completer():
    ingredient_data = get_ingredient_data(DEFAULT_DATASET)
    common_ingredients, uncommon_ingredients, rare_ingredients = split_ingredients_by_rarity(ingredient_data)
    return render_template(
        'recipe_completer.html',
        common_ingredients=common_ingredients,
        uncommon_ingredients=uncommon_ingredients,
        rare_ingredients=rare_ingredients,
        regions=REGIONS,
        potion_names_json=json.dumps(potion_names_data)
    )


@app.route('/complete-recipe', methods=['POST'])
def complete_recipe():
    payload = request.get_json() or {}

    user_ingredients = payload.get('ingredients', [])
    dataset = payload.get('dataset') or payload.get('year') or DEFAULT_DATASET
    current_region = payload.get('region') or "Gift of Shuritashi"
    target_type = payload.get('potion_type')
    target_value = int(payload.get('potion_value'))

    ingredient_data = get_ingredient_data(dataset)
    selected_ingredients = [ing for ing in ingredient_data if ing['name'] in user_ingredients]
    selected_names = {ing['name'] for ing in selected_ingredients}

    complete_inventory_results = []
    for owned_combo in combinations(selected_ingredients, 3):
        total_combat = sum(ing['combat'] for ing in owned_combo)
        total_utility = sum(ing['utility'] for ing in owned_combo)
        total_whimsy = sum(ing['whimsy'] for ing in owned_combo)

        recipe_types = []
        if total_combat > 0 and total_combat >= total_utility and total_combat >= total_whimsy:
            recipe_types.append(("Combat", total_combat))
        if total_utility > 0 and total_utility >= total_combat and total_utility >= total_whimsy:
            recipe_types.append(("Utility", total_utility))
        if total_whimsy > 0 and total_whimsy >= total_combat and total_whimsy >= total_utility:
            recipe_types.append(("Whimsy", total_whimsy))

        if (target_type, target_value) in recipe_types:
            complete_inventory_results.append({
                "owned_ingredients": [
                    {
                        "name": ing["name"],
                        "rarity": normalize_rarity(ing["rarity"]),
                        "combat": ing["combat"],
                        "utility": ing["utility"],
                        "whimsy": ing["whimsy"]
                    } for ing in owned_combo
                ],
                "attribute_totals": f"[{total_combat}-{total_utility}-{total_whimsy}]"
            })

    if complete_inventory_results:
        return jsonify({
            "target_potion": get_potion_display_name(target_type, target_value),
            "already_complete": True,
            "complete_recipes": complete_inventory_results,
            "results": [],
            "message": "Potion can be brewed using current inventory—no additional ingredients needed."
        })

    possible_results = []

    for candidate in ingredient_data:
        if candidate['name'] in selected_names:
            continue

        for owned_pair in combinations(selected_ingredients, 2):
            combo = list(owned_pair) + [candidate]
            total_combat = sum(ing['combat'] for ing in combo)
            total_utility = sum(ing['utility'] for ing in combo)
            total_whimsy = sum(ing['whimsy'] for ing in combo)

            recipe_types = []
            if total_combat > 0 and total_combat >= total_utility and total_combat >= total_whimsy:
                recipe_types.append(("Combat", total_combat))
            if total_utility > 0 and total_utility >= total_combat and total_utility >= total_whimsy:
                recipe_types.append(("Utility", total_utility))
            if total_whimsy > 0 and total_whimsy >= total_combat and total_whimsy >= total_utility:
                recipe_types.append(("Whimsy", total_whimsy))

            if (target_type, target_value) not in recipe_types:
                continue

            distance_rank, distance_label, availability_regions = ingredient_distance_label(candidate, current_region)

            possible_results.append({
                "missing_ingredient": {
                    "name": candidate["name"],
                    "rarity": normalize_rarity(candidate["rarity"]),
                    "combat": candidate["combat"],
                    "utility": candidate["utility"],
                    "whimsy": candidate["whimsy"]
                },
                "owned_ingredients": [
                    {
                        "name": ing["name"],
                        "rarity": normalize_rarity(ing["rarity"]),
                        "combat": ing["combat"],
                        "utility": ing["utility"],
                        "whimsy": ing["whimsy"]
                    } for ing in owned_pair
                ],
                "attribute_totals": f"[{total_combat}-{total_utility}-{total_whimsy}]",
                "distance_rank": distance_rank,
                "distance_label": distance_label,
                "availability_regions": availability_regions
            })

    deduped = {}
    for result in possible_results:
        key = (result["missing_ingredient"]["name"], tuple(sorted(ing["name"] for ing in result["owned_ingredients"])))
        if key not in deduped or result["distance_rank"] < deduped[key]["distance_rank"]:
            deduped[key] = result

    results = sorted(
        deduped.values(),
        key=lambda r: (
            r["distance_rank"],
            r["missing_ingredient"]["rarity"] != "common",
            r["missing_ingredient"]["rarity"] != "uncommon",
            r["missing_ingredient"]["name"]
        )
    )

    if results:
        best_rank = results[0]["distance_rank"]
        results = [result for result in results if result["distance_rank"] == best_rank]

    return jsonify({
        "target_potion": get_potion_display_name(target_type, target_value),
        "results": results,
        "message": "No single ingredient completes this potion from your current inventory. Try selecting different ingredients or adding to your inventory."
    })


if __name__ == '__main__':
    app.run(debug=True)
