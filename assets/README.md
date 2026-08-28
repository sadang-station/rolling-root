# Rolling Root runtime assets

`presets/` contains the provided source asset pack. `assets/` contains the
runtime copies that Vite serves and packages; application code must load only
from this directory. No Unity project or backup asset is a runtime dependency.

| Directory | Contents |
| --- | --- |
| `assets/images` | 406soft logo, player faces, ice cream, bicycle |
| `assets/audio` | BGM plus start, jump, game-over, and bicycle effects |
| `assets/fonts` | One Mobile POP display font |
| `assets/favicon.png` | 512px browser favicon derived from the provided player face |

To add or replace an asset, first copy the provided file from `presets/` into
the matching `assets/` subdirectory. Keep names stable and reference its
root-relative public URL, for example `/images/root.png` or `/audio/jump.mp3`.
