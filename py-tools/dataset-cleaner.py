import csv
from pathlib import Path

INPUT_FILE = Path("raw-datasets/cities15000-raw.txt")
OUTPUT_FILE = Path("clean-datasets/cities15000.txt")

# Raw GeoNames indexes
NAME_INDEX = 1
LATITUDE_INDEX = 4
LONGITUDE_INDEX = 5
COUNTRY_CODE_INDEX = 8
POPULATION_INDEX = 14
DEM_INDEX = 16

# Cleaned output columns:
# name, country_code, population, latitude, longitude, dem


def clean_name_for_duplicate_check(name: str) -> str:
    """
    Normalizes city names for duplicate comparison.

    This makes the duplicate check case-insensitive and ignores leading/trailing spaces.
    It does NOT remove accents, so 'Sao Jose' and 'São José' are treated as different names.
    """
    return name.strip().casefold()


def main():
    largest_population_by_name = {}

    # First pass: find the largest population for each city name
    with INPUT_FILE.open("r", encoding="utf-8", newline="") as infile:
        reader = csv.reader(infile, delimiter="\t")

        for row in reader:
            if len(row) <= DEM_INDEX:
                continue

            name_key = clean_name_for_duplicate_check(row[NAME_INDEX])

            try:
                population = int(row[POPULATION_INDEX])
            except ValueError:
                continue

            if name_key not in largest_population_by_name:
                largest_population_by_name[name_key] = population
            else:
                largest_population_by_name[name_key] = max(
                    largest_population_by_name[name_key],
                    population
                )

    kept_count = 0
    removed_duplicate_count = 0
    skipped_count = 0
    seen_kept_names = set()

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Second pass: write only the largest version of each city name
    with INPUT_FILE.open("r", encoding="utf-8", newline="") as infile, \
         OUTPUT_FILE.open("w", encoding="utf-8", newline="") as outfile:

        reader = csv.reader(infile, delimiter="\t")
        writer = csv.writer(outfile, delimiter="\t")

        writer.writerow([
            "name",
            "country_code",
            "population",
            "latitude",
            "longitude",
            "dem"
        ])

        for row in reader:
            if len(row) <= DEM_INDEX:
                skipped_count += 1
                continue

            name = row[NAME_INDEX]
            name_key = clean_name_for_duplicate_check(name)

            try:
                population = int(row[POPULATION_INDEX])
            except ValueError:
                skipped_count += 1
                continue

            largest_population = largest_population_by_name[name_key]

            # Keep only the largest city for this name.
            # If there is an exact population tie, keep the first one only.
            if population == largest_population and name_key not in seen_kept_names:
                writer.writerow([
                    row[NAME_INDEX],
                    row[COUNTRY_CODE_INDEX],
                    row[POPULATION_INDEX],
                    row[LATITUDE_INDEX],
                    row[LONGITUDE_INDEX],
                    row[DEM_INDEX]
                ])

                seen_kept_names.add(name_key)
                kept_count += 1
            else:
                removed_duplicate_count += 1

    print(f"Done. Cleaned file saved as: {OUTPUT_FILE}")
    print(f"Kept {kept_count:,} cities")
    print(f"Removed {removed_duplicate_count:,} smaller duplicate cities")
    print(f"Skipped {skipped_count:,} malformed rows")


if __name__ == "__main__":
    main()