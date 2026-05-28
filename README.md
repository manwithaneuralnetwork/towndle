# Towndle

Towndle is a daily city-guessing map game. Each difficulty gets five deterministic rounds per day, resetting at midnight in New York.

## Files

- `index.html`, `styles.css`, `app.js`: static web app
- `clean-datasets/`: public datasets used by the browser
- `py-tools/`: local dataset preparation helpers
- `raw-datasets/`: original source data kept for reference

## Local Dev

Run a static server from the project root:

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5173/`.

