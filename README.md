# PayUp

Bon's bill splitting app: a minimalist calculator for splitting a restaurant bill with friends. Add who ordered what, type in the total on the receipt, and it shares out the service charge by how much each person ordered, then shows Bon's GCash QR so everyone can pay.

## How the split works

The receipt total is always more than the menu prices because of the service charge. The app adds up the food, takes whatever is left over on the receipt (service charge, other taxes) and gives each person a share of it at the same rate:

```
your share = your food × receipt total ÷ food total
```

Everyone's shares add up exactly to the receipt total, so you never need to know the service charge rate.

## Pay links and history

Bills save online to Supabase as you edit them, and still save on the phone first, so the app works offline.

- **Send pay link** (in a person's panel) or **Share split** sends each friend their own link. It opens a page with their amount, their items and three steps to pay Bon with GCash: save the QR, copy the amount, open GCash and upload the QR. The page refreshes when the bill changes.
- **History** lists past bills. Tap one to reopen it. **Clear all** starts a new bill and keeps the old one in History.

Each phone gets a quiet anonymous account, so there's no login. Only the phone that made a bill can see, change or delete it. A friend's link can read that one bill and nothing else.

To set up your own Supabase project, run `supabase.sql` in its SQL Editor, turn on Anonymous sign-ins, and put the project URL and publishable key in `cloud.js`. Never put the secret or service-role key in the app.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The app's page |
| `styles.css` | The minimalist look: black and white, thin lines, light and dark mode |
| `app.js` | People, items, sheets, sharing, history and the launch screen |
| `calc.js` | The split math |
| `cloud.js` | Saving bills to Supabase, the history list and pay links |
| `pay.js` | The page a friend sees when they open their pay link |
| `supabase.sql` | The database table and access rules for Supabase |
| `vendor/supabase.js` | The Supabase JavaScript library (MIT), kept in the repo so the app works offline |
| `gcash-qr.svg` | Bon's GCash QR, redrawn from the GCash app's QR so it stays sharp at any size |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the Home Screen icon |

## Using it on iPhone

Open https://vzq1.github.io/payup/ in Safari, tap **Share → Add to Home Screen**, and name it **PayUp**. It works offline after the first visit.

Tap the half-circle at the top right for dark mode. The GCash QR always stays black on white so it scans.

## Running it locally

There's no build step. Serve the folder and open http://localhost:8000:

```
python3 -m http.server
```

## Credits

- [supabase-js](https://github.com/supabase/supabase-js) (MIT), license in `vendor/supabase-js.LICENSE`.
- GCash and InstaPay are trademarks of their respective owners.
