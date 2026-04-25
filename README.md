# Monterey Hardness — companion site

Live data explorer for **Weller & Behl (2026)** — *Unique hardness and porosity
patterns in siliceous rocks of the Monterey Formation, Belridge Oil Field, CA*
(SPE-232849).

Static site. No build step. No external dependencies. Hosted on GitHub Pages
at **si-hardness.ryweller.com**.

## What's in here

```
site/
├── index.html              # the page (dataset embedded inline)
├── CNAME                   # custom domain for GitHub Pages
├── .nojekyll               # tells Pages not to mangle filenames
├── README.md               # this file
└── assets/
    ├── styles.css          # all styling, no preprocessor
    ├── main.js             # filtering, charting, R², CSV download
    ├── data.json           # 1,546 measurements (also inlined in index.html)
    └── data.csv            # same data as flat CSV (download button target)
```

## Run locally

Just open `index.html` in a browser. Because the dataset is inlined in the
HTML, no local server is needed — `file://` works.

If you'd rather serve it:

```sh
cd site
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages with custom domain

1. **Push this folder to a GitHub repo.** A common pattern:
   - Repo: `ryweller/monterey-hardness` (or any name)
   - Branch: `main`
   - Either put these files at the repo root OR keep them in `site/` and
     point Pages at that folder.

2. **Enable GitHub Pages.**
   In the repo: *Settings → Pages → Build and deployment*
   - Source: *Deploy from a branch*
   - Branch: `main` / `/` (root)  — or `main` / `/site` if you keep this
     folder structure.

3. **Custom domain.**
   - GitHub Pages → *Custom domain* → enter `si-hardness.ryweller.com` → Save.
   - Tick *Enforce HTTPS* once the cert provisions (usually a few minutes).
   - The `CNAME` file in this folder pins the domain so Pages doesn't drop it
     on the next deploy.

4. **DNS at your registrar.**
   For `si-hardness.ryweller.com`, add a single record on `ryweller.com`'s DNS:

   ```
   Type   Host          Value                 TTL
   CNAME  si-hardness   ryweller.github.io.   3600
   ```

   (Replace `ryweller` with your GitHub username if different.)

5. **Verify.** Wait for DNS to propagate (5–60 minutes). Visit
   `https://si-hardness.ryweller.com`. You should see the full site.

## Updating the data

The dataset is embedded in `index.html` so the page works on `file://`. To
update:

1. Re-export `assets/data.json` from the source CSV (any pandas/csv script
   that produces the same row shape).
2. Replace the inlined dataset in `index.html` between the
   `<script type="application/json" id="dataset">…</script>` tags with the
   new JSON, OR delete that block entirely and the page will fall back to
   `fetch("assets/data.json")` automatically when served over http(s).

The shape of each row in `data.json`:

```json
{
  "w": "548D1-35",          // well
  "d": 3467.5,              // depth (ft)
  "sl": 72.6,               // silica %  (biogenic + diagenetic)
  "dt": 27.4,               // detritus %
  "p":  "opal-CT",          // phase: opal-A | mixed | opal-CT | 6k-quartz | 12k-quartz
  "g":  "low",              // detritus group: low | mod | high
  "hld": 662,               // avg HLD
  "sd":  18.4,              // HLD std dev
  "x":   1,                 // XRD-confirmed (1) or not (0)
  "k":   0.4,               // perm Kair (md)
  "o":   49.5,              // helium porosity %
  "gd":  2.34,              // grain density (g/cc)
  "t":   3.1,               // TOC (%)
  "q":   0,                 // bad-HLD-fracs flag: 0=very good, 1=good, 2/3=poor
  "u":   45.2               // UCS (MPa, Lee)
}
```

Any of the fields besides `w`, `d`, `p`, and `hld` may be `null` for a row.

## What the page does

- **Hero**: Fig 4 (HLD vs silica %) on the full unfiltered dataset, colored by
  silica phase, with within-phase OLS trend lines.
- **Five conclusions**: the manuscript's five conclusion points. Click any
  finding to jump to a matching preset in the explorer.
- **Explorer**: real-time filtering on phase, well, depth, porosity, silica %,
  detritus group, data quality, plus advanced filters (XRD-confirmed only,
  TOC, perm). Axis selectors for X / Y / color. Trend-line toggle, group
  means, log-scale toggles, swap axes, PNG/SVG/CSV export. Active-filter pill
  strip. Within-phase R² badge updated live. Phase composition bar updated
  live.
- **Share view**: encodes the full filter+axis state into a URL hash so any
  view is shareable.

## License

Data: © Weller & Behl. Cite SPE-232849 if you use this dataset in research.
Site code: do whatever's useful; no warranty.
