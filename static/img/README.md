# Sprites

The renderer looks for `doge.png`, `buff.png` and `cheems.png` in this
directory first, and falls back to `stub/` when they are absent.

## stub/

Kenney's platformer aliens, released under CC0. `doge.png` is the alien's stand
pose, `buff.png` its jump and `cheems.png` its hurt, which is a closer fit to
what the renderer wants than the names suggest: these are not three characters
but one character in three states, and the page switches between them as a
panelist lands a roast or takes one. A fresh clone runs and animates with these,
so nothing is broken out of the box.

Source: Platformer Art (more enemies and animations) by Kenney Vleugels,
www.kenney.nl, CC0 1.0. Cut from the pack's `Vector/aliens.svg` rather than its
PNGs, so they are rendered at the size the page draws them instead of being
upscaled from 66 by 92. Otherwise unmodified.

CC0 asks for nothing, but the credit above is there because Kenney asks nicely
and it costs a line.

### Anchors

These do not sit where the meme art sits. The alien is mostly helmet, so its
head anchor is centred and high where doge's is offset and lower, and the
provider mark rides the upper dome rather than the middle of the face. That is
deliberate: the mark is drawn over the head, and the face is the only thing
distinguishing stand from hurt once the silhouette is flat-tinted for a hit
flash, so covering it would collapse two of the three states into one.

Both sets of numbers therefore live in `static/arena.js`. `head`, `markR` and
`tag` are measured off the meme art; `stubAt` off these placeholders, and the
loader swaps them in when it falls back here. Redrawing or replacing a stub
means re-measuring `stubAt` only, and leaves whatever is in the parent directory
alone.

## This directory

Not committed. `.gitignore` excludes `*.png` here precisely so that meme
artwork never enters the history.

The obvious thing to put here is the classic doge and the buff-doge-vs-cheems
template. Note what those are before you distribute them. The doge photograph
is Atsuko Sato's, taken of her dog Kabosu in 2010 and never released into the
public domain. Cheems is a different dog, Balltze, photographed by a different
owner. The buff body is a third party's edit layered on Sato's photograph. That
is three rights holders and no licence, so those files are fine on your own
machine and are not ours to redistribute.

Any transparent PNGs of those three names work. The renderer scales by height
and preserves aspect ratio, so source proportions do not need to match, though
the per-sprite `head` and `tag` anchors in `static/arena.js` are measured
fractions and assume a roughly upright figure.
