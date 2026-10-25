# Artwork credits

Cover artwork is supplied by [libretro-thumbnails contributors](https://github.com/libretro-thumbnails/libretro-thumbnails#credits). The underlying game artwork belongs to the respective developers and publishers. Public availability and attribution do not establish a blanket reuse license.

The filename inventories were retrieved on 2026-09-09 from verified repository trees and libretro thumbnail directory listings. The matching script compares normalized titles only, prefers normal USA/World releases, and excludes recognized prototypes, demos, pirate variants and hacks. No fuzzy match is used. Regional covers may differ from the title or release year shown in the catalog.

- `data/artwork.json` stores the selected source and image URLs.
- Covered games expose a source link in their details.
- Selected popular-game covers are bundled in `assets/covers/`; the rest are loaded lazily from their source.
- Images retain their original aspect ratio inside the cover frame.
- Unmatched titles and failed image requests display a title/system label.

Sources include the individual system repositories in [libretro-thumbnails](https://github.com/libretro-thumbnails) and [the libretro thumbnail server](https://thumbnails.libretro.com/). Sources for C64 and DOS were taken from actual directory listing hyperlinks rather than inferred GitHub paths.

Some modern systems have no corresponding repository, and Vita/PS3/PS4/Xbox 360 coverage is sparse. Absence of artwork is not evidence that a game does not exist.
