import sys
import os

# Add scripts dir to path
sys.path.append(os.path.join(os.getcwd(), 'scripts'))

from shared import get_existing_units

def main():
    counts = get_existing_units('Radyoloji')
    print("Radyoloji Üniteleri:")
    for unit, count in counts.items():
        print(f" - {unit}: {count} soru")

if __name__ == "__main__":
    main()
