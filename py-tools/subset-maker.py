import csv
from pathlib import Path

# Take from the clean 15k dataset
INPUT_FILE = Path("clean-datasets/cities15000.txt")
OUTPUT_DIR = Path("clean-datasets")

# Clean dataset columns:
# 0 = name
# 1 = country_code
# 2 = population
# 3 = latitude
# 4 = longitude
# 5 = dem
POPULATION_INDEX = 2


def make_city_subset(min_population: int):
    if min_population <= 15000:
        raise ValueError("min_population must be greater than 15000.")

    output_file = OUTPUT_DIR / f"cities{min_population}.txt"

    kept_count = 0
    skipped_count = 0

    with INPUT_FILE.open("r", encoding="utf-8", newline="") as infile, \
         output_file.open("w", encoding="utf-8", newline="") as outfile:

        reader = csv.reader(infile, delimiter="\t")
        writer = csv.writer(outfile, delimiter="\t")

        # Read and copy header
        header = next(reader, None)
        if header is not None:
            writer.writerow(header)

        for row in reader:
            if len(row) <= POPULATION_INDEX:
                skipped_count += 1
                continue

            try:
                population = int(row[POPULATION_INDEX])
            except ValueError:
                skipped_count += 1
                continue

            if population >= min_population:
                writer.writerow(row)
                kept_count += 1

    print(f"Done. Created {output_file}")
    print(f"Kept {kept_count:,} cities with population >= {min_population:,}")
    print(f"Skipped {skipped_count:,} malformed rows")


if __name__ == "__main__":
    n = int(input("Minimum population greater than 15000: "))
    make_city_subset(n)