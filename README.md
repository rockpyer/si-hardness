# Monterey Hardness

**Interactive data companion to Weller & Behl (2026)**
*Unique hardness and porosity patterns in siliceous rocks of the Monterey Formation, Belridge Oil Field, California*
SPE-232849

🌐 **[si-hardness.ryweller.com](https://si-hardness.ryweller.com)**

---

## About

This is the open-data companion site to a 2026 SPE manuscript presenting 1,546 rebound-hardness (Leeb HLD) measurements from siliceous mudrocks of the Monterey Formation, collected across four cored wells in the Belridge Oil Field, San Joaquin Basin, California.

The site provides an interactive explorer for the full dataset — filter by silica phase, depth, porosity, composition, and well; visualize any combination of variables; and download a filtered CSV or reproduce the paper's key figures with one click.

### Key findings

- **Composition is the first-order control on hardness** within every burial/diagenetic group — stronger than burial depth or porosity alone
- The opal-A → opal-CT transition produces the largest single hardness jump (+47% HLD median)
- Opal-CT resists mechanical compaction with burial, making it uniquely burial-resistant
- Within each phase, porosity *positively* correlates with hardness — an inversion of the classical porosity-strength relationship, driven by detrital clay content
- 12k′-quartz rocks gain 25–30% HLD over 6k′-quartz without further phase change, likely driven by clay diagenesis and early oil catagenesis

## Dataset

| Field | Description |
|-------|-------------|
| Rebound hardness (HLD) | Leeb rebound, 1,546 measurements |
| Helium porosity (%) | Core-plug, paired subset |
| Silica (%) | Biogenic + diagenetic, XRD |
| Detritus (%) | Clay + quartz detritus |
| Silica phase | opal-A · mixed A-CT · opal-CT · 6k′-quartz · 12k′-quartz |
| Depth (ft TVD) | 800–12,600 ft |
| Well | 4 cores, Belridge Oil Field |

Full data available as [`assets/data.csv`](assets/data.csv) and [`assets/data.json`](assets/data.json).

## Cite this work

> Weller, R. W., & Behl, R. J. (2026). Unique hardness and porosity patterns in siliceous rocks of the Monterey Formation, Belridge Oil Field, California. *SPE-232849.*

Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — you are free to share and adapt with attribution and share-alike.

## Authors

**R. W. Weller** · California State University, Long Beach · [LinkedIn](https://www.linkedin.com/in/ryweller/)

**R. J. Behl** · California State University, Long Beach · [LinkedIn](https://www.linkedin.com/in/richard-rick-behl-6b75825/)

### Acknowledgements

This research was financially supported by the affiliate companies of the CSULB MARS Project (Monterey and Related Sediments) without restriction. Aera Energy LLC and California Resources Corporation graciously supplied core, data, and equipment in support of this study.

## Repository

Static site — no build step, no external dependencies. Open `index.html` directly in a browser or serve with any static host.

```
index.html          # full page (dataset embedded inline)
assets/
├── styles.css      # all styling
├── main.js         # filtering, charting, export
├── data.json       # 1,546 measurements
└── data.csv        # same data, flat CSV
```
