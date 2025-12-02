import json
from part1 import data1
from part2 import data2
from part3 import data3

full_data = data1 + data2 + data3

with open('public/scene.json', 'w') as f:
    json.dump(full_data, f, indent=2)

print(f"Successfully merged {len(full_data)} objects into public/scene.json")
