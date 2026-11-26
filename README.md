<div align="center">

# ❄️ Flurry

**Weather for your [Omarchy](https://omarchy.org) desktop.**
Snow piles up on your windows, Santa flies by, a winter hare hops through the drifts,
and a little yellow plow clears it all away.

[![Omarchy 4](https://img.shields.io/badge/Omarchy-4%20Quattro-7aa2f7?style=flat-square)](https://omarchy.org)
[![Quickshell](https://img.shields.io/badge/Quickshell-0.3-bb9af7?style=flat-square)](https://quickshell.org)
[![Languages](https://img.shields.io/badge/i18n-English%20%C2%B7%20%D9%81%D8%A7%D8%B1%D8%B3%DB%8C-9ece6a?style=flat-square)](i18n/)
[![License: MIT](https://img.shields.io/badge/license-MIT-e0af68?style=flat-square)](LICENSE)

<img src="docs/screenshots/hero.jpg" alt="Snow on two windows, Christmas trees, snowmen and Santa's sleigh over a sunset wallpaper" width="100%">

</div>

```bash
omarchy plugin add https://github.com/itscallssh/omarchy-flurry.git --enable
```

A snowflake lands on the right of your bar. Click it, pick a weather, and get back to work.
Requires Omarchy 4 (Quattro) or later. Gifts between friends also use `curl` and
`wl-clipboard`, which Omarchy ships.

Optional: for compositor-anchored window snow/frost/icicles with zero drag lag (see [`hyprland-plugin/`](hyprland-plugin/README.md)):

```bash
hyprpm add https://github.com/itscallssh/omarchy-flurry
hyprpm enable flurry-anchor
```

### Removing

```bash
omarchy plugin remove itscallssh.flurry
```

This takes Flurry off your bar and desktop. Your saved trees, snowmen and
settings live in `~/.local/state/omarchy-flurry` (delete that folder too for a clean slate).
If you installed the optional Hyprland anchor plugin, also run `hyprpm remove flurry`.

### Updating

Get the latest fixes and features whenever you like:

```bash
omarchy plugin update itscallssh.flurry
```

or `flurry update` (add `--yes` to skip the question). It shows you what changed, asks before applying it, and reloads Flurry. Your
trees, snowmen, friends and settings stay as they are. Add `--yes` to skip the
question, or leave out the name to update all your plugins at once.

<details>
<summary>If the update says "not a git checkout" or "local changes"</summary>

That copy wasn't installed with `omarchy plugin add` (or its files were edited
by hand), so there's nothing to pull from. Reinstall it once; your saved state
lives outside the plugin folder and stays:

```bash
omarchy plugin remove itscallssh.flurry --yes
omarchy plugin add https://github.com/itscallssh/omarchy-flurry.git --enable
```

From then on `omarchy plugin update itscallssh.flurry` works.
</details>

<p align="center"><img src="docs/screenshots/snowfall.gif" alt="Snow falling past a terminal and settling on its top edge" width="720"></p>

## 🌦️ Six kinds of weather

| | | |
|:---:|:---:|:---:|
| <img src="docs/screenshots/effect-snow.jpg" alt="Snow"> | <img src="docs/screenshots/effect-leaves.jpg" alt="Leaves"> | <img src="docs/screenshots/effect-sakura.jpg" alt="Sakura"> |
| **Snow**: settles on window tops and the ground, slides off when you fling a window | **Leaves**: pile up and scatter when you brush the pointer through them | **Sakura**: petals drift down and rest on your windows for a while |
| <img src="docs/screenshots/effect-fireflies.jpg" alt="Fireflies"> | <img src="docs/screenshots/effect-starfall.jpg" alt="Starfall"> | <img src="docs/screenshots/effect-rain.jpg" alt="Rain"> |
| **Fireflies**: drift about and gather where the pointer rests | **Starfall**: shooting stars that burst into sparks on your windows | **Rain**: falls in layers, gathers on window tops and pours off their ends, puddles on the ground, with forked lightning now and then |

Scroll on the bar icon to flip through them, or `flurry effect sakura`.

<sub>These six tiles are drawn by Flurry's own simulation and painter (`lib/sim.js`, `lib/draw.js`) over Omarchy theme wallpapers. Every other picture here is a screenshot of the real Omarchy shell.</sub>

## 🎄 Decorate your desktop

<img src="docs/screenshots/decorations.jpg" alt="A decorated tree, a snowman with a blue scarf and a wrapped present on the snowy ground" width="100%">

Plant up to three trees and hang baubles, lights, candy canes and a star on them. Roll
snowmen and dress them (hat, carrot nose, a scarf in your theme colour), set one on a
window and it rides along. String lights along any app's windows. Everything stays where
you leave it across restarts.

## 🚜 The snow plow

<img src="docs/screenshots/plow.jpg" alt="A yellow bulldozer pushing a berm of snow across the bottom of the screen" width="100%">
<img width="314" height="155" alt="image" src="https://github.com/user-attachments/assets/e780357e-b486-4bc0-a50f-11dfbdcd039a" />


When the snow along the bottom gets deep, a little yellow bulldozer drives in, drops its
blade and shoves it all off the far side. It's part of the simulation, not an animation on
top: the berm grows, chunks tumble off it, and its weight slows the dozer down.

It never comes unannounced. First the winter hare hops in onto the snow; five seconds later a
robin flies in and lands near it. The two potter about for a few seconds, hopping, sniffing,
pecking, sitting up, and then the plow rumbles in. The hare bolts away from it and the robin
takes off, and the plow clears the snow.

## 🐇 Little visitors

| | |
|:---:|:---:|
| <img src="docs/screenshots/hare.jpg" alt="A white winter hare sitting in the snow"> | <img src="docs/screenshots/yeti.jpg" alt="The Yeti walking past a decorated tree"> |
| **A winter hare** wanders the drifts, stops to nibble and look about, and bolts when your cursor comes close | **The Yeti** comes for your snowman. Click him and he runs off without it |

A robin perches on your windows, Santa rides by now and then (click him for a present), and
very rarely a golden snowflake falls. Catch it for a new bauble finish.

## ❄️ Icicles, spring and New Year

<img src="docs/screenshots/icicles.jpg" alt="Icicles hanging under a terminal window" width="100%">

On cold nights the windows freeze: icicles grow, frost creeps into the corners and the snow
glazes over. In the two weeks before **Nowruz** the snow thaws, sprouts come up and a brown
hare comes out. At midnight on January 1st there's a quiet countdown and fireworks behind
your windows.

<img src="docs/screenshots/spring.jpg" alt="Spring: a brown hare by the tree, sprouts coming up through the melting snow" width="100%">

## 🎛️ The panel, in English and Persian

<p align="center"><img src="docs/screenshots/panel-en-fa.png" alt="The Flurry panel in English and in Persian" width="720"></p>

Click the snowflake for the panel: a live preview, the six effects, the amount, big on/off
switches for the **Snow plow**, **Snowballs**, **Santa and the Yeti** and **Little visitors**,
and quick actions. **World** has live weather, melting, seasons and calm mode; **Friends**
has your friend code and gifts. It follows Omarchy's language setting.

| | |
|---|---|
| Click the bar icon | Open the panel |
| Right-click it | Weather on or off |
| Scroll on it | Next or previous effect |
| Drag a decoration | Move it; drop a snowman on a window's top edge and it rides that window |
| Right-click a tree or snowman | Send it to a friend, or remove it |
| Click a gift or a letter | Open it |
| Click Santa | He drops a present |
| Click the Yeti | He runs off without your snowman |

## 🔊 Sound

Every effect has its own sound: steady rain, autumn wind through dry
leaves, a hush of winter wind under the snow, a quiet night pad for
starfall, a spring breeze with a distant chime for sakura, and crickets with
the fireflies. And things sound when they happen, in the same frame: thunder
with every lightning flash (close ones crack, far ones roll), a soft thud
when a window throws its snow off, icicles snapping, a glint for a shooting
star, New Year fireworks, sleigh bells for Santa. Each has a few variants,
never the same one twice running.

Turn it off, or set its volume, under **Sound** in the panel. In calm mode it all
plays at half level; behind a fullscreen app it is quiet.
`flurry sound test` plays a thunder now, and `flurry sound status` says why it
is quiet, if it is. The sounds are made by
`tools/make-sounds.py` (no samples, nothing to license). It plays through
Qt Multimedia (`qt6-multimedia`) when it's there; without it everything plays
through `pw-play` or `paplay`.

## 🎁 Send gifts to friends

1. **Set up friends** in the panel, then **Copy my code** and send it to a friend.
2. Copy their code and press **Add from clipboard** (or `flurry add <code>`).
3. Right-click a snowman or tree, **Send to …**. A little train comes for it and pulls up on
   your friend's desktop. Notes go the same way, and you can even throw snowballs over.

## 🪶 Light on your machine

While it's off or hidden, Flurry stops watching your windows and pointer entirely. When nothing on
screen is moving (a clear sky over lying snow), it stops drawing frames and only looks in once a
second. It reads your window list on a timer only while you drag a window. It pauses under
fullscreen apps, slows down on battery, and has a calm mode for work hours. A full-snow frame
costs about 0.25 ms of simulation on a 2560×1440 screen.

---

## The details

<details>
<summary><b>How the snow behaves</b></summary>

Every falling thing shares one gravity. Flakes, powder and petals reach their
fall speed through drag in moving air: a slow wind, gusts that vary across the
screen, and the wake of a fast pointer. Chunks are heavy and fall fast.

Snow on a window is a height field that carries its own sliding speed. The
window's motion is estimated from its position samples, and in the window's
frame the snow feels gravity minus the window's acceleration:

- **Friction.** It holds until the sideways pull beats static friction, then
  slides, braked by kinetic friction, and sticks again once it stops. Each
  patch grips a little differently, so a slab tears instead of moving as one.
- **Cohesion and age.** Fresh powder is loose: it slides easily, smears, and
  turns to dust. Over a couple of minutes it settles: it grips better, holds
  steeper slopes, moves as slabs, and breaks off in chunks.
- **Edges.** Snow that slides past an edge hangs there as a small cornice and
  breaks off once it's too heavy. Piles steeper than the angle of repose
  slump, and an over-full edge pours over on its own.
- **Lift-off.** Drop a window (or stop it rising) faster than gravity and the
  snow floats off and lands again.
- **Spray and wind.** A fast-moving window strips loose powder into a trailing
  plume; wind drifts loose snow downwind.
- **Landing.** Chunks shed dust as they fall, break up when they hit hard, and
  skid a little along whatever they land on. Rising windows scoop up the snow
  falling onto them.
- **Hidden, not lost.** Snow on a window behind another is hidden where it's
  covered and shows again when the front window moves. A window on another
  workspace keeps its snow until you come back. Resizing keeps the snow where
  it lies and drops what the window no longer reaches.

</details>

<details>
<summary><b>More about the snow plow</b></summary>

The trigger is the depth of the ground snow, never a timer: when the snow
along the bottom of the screen gets deep (on average 42% of the way to full,
about 11 px all along; `PLOW.threshold` in `lib/sim.js`, checked twice a
second), a yellow bulldozer drives in from the edge with its blade up,
lowers it, and pushes the snow across and off the far side. It's part of
the simulation, not an animation over it:

- The blade scrapes the ground snow down to nothing, and what it scrapes
  becomes a berm heaped against the blade. The berm grows to well over the
  blade's top, and its weight slows the dozer down.
- Chunks tumble off the berm's face, land ahead of it and get pushed again;
  a berm over the blade's top curls powder over it.
- The tracks' bottom run stays put on the ground while the top run moves,
  the wheels and sprocket turn by the distance driven, the nose dips as the
  berm pushes back, and the engine shakes it a little.
- The exhaust puffs harder under load and drifts on the wind; the beacon
  turns; snow settles on the cab roof and slides off when it pulls away.

It leaves once its rear is past the edge, rests at least six seconds
(`PLOW.rest`, the cooldown), and comes back from the other side next time
the snow builds up past the threshold.

**Its visitors come first.** Every plow run, whether the deep snow called it,
you pressed the plow button in the panel, or ran `flurry plow`, goes like
this (`ARRIVAL` in `lib/sim.js` holds every timing):

1. The plow is held. The winter hare hops in from the far edge (the side the
   plow won't come from) onto the ground snow.
2. 5 s after the hare is in (`birdDelay`), the robin flies in from the same
   side and lands on the ground near it, or on a low window ledge close by.
3. Both stay and potter about: the hare walks, hops, sniffs at the snow and
   sits up to look about; the robin hops and pecks. This lasts 6–8 s after
   the robin lands (`linger`).
4. The plow drives in. They react to it, not to a clock: once it shows on the
   screen the hare sits up and stares for a moment, then bolts off the screen
   away from it (at once if it gets within 340 px, `hareFlee`), and the robin
   takes off the same way (`birdFlee`, 420 px).
5. The plow clears the snow as usual.

A hare or robin already on the screen is taken into the sequence rather than
a second one sent, and while it runs the random visitors don't come (the
panel says "the plow's visitors are here"). It runs in any sky the plow
runs in: rain, sleet or a blizzard on live weather keep the *random* robin
and hare away, but the plow only comes with snow lying anyway, so its two
come regardless. In calm mode the plow comes alone. If the scene hides (a
fullscreen app, Flurry off) or you switch workspace mid-sequence, it is
cancelled: the visitors leave (or are simply gone, when hidden), and the
plow is never held: it rests 10 s (`retry`) and then the deep snow calls it,
with its visitors, again. However things go, the plow is held at most 40 s
(`maxHold`). A call while the visitors are already here answers "already on
its way". `flurry diag` shows the sequence under `plowArrival`: its timings,
the phase it is in and what comes next, and the last run's log with times.

**The Snow plow switch** (in the menu, or `flurry plow on|off|toggle`) is on
by default. Off, the plow never comes: not when the snow builds up, and not
when called. `flurry plow` with nothing after it calls it now while the
switch is on, and is refused with a message ("the snow plow is off") while
it is off. Switch it off while one is out and it doesn't stop or vanish: it
finishes its pass a little quicker, blade down, and drives off the far side.

</details>

<details>
<summary><b>Snowballs</b></summary>

Press on snow that's lying deep enough (the pointer turns into an open hand
over it) and a lumpy handful comes up. Drag it along the snow and it rolls:

- **It grows.** Each stretch of fresh snow it rolls onto sticks to it as a
  layer, more from settled snow than from powder, so it gets bigger the
  further you roll it, and rounder as it goes. New layers show as clumps and
  seams on its face, and they turn with it.
- **It rolls.** It turns exactly as far as it travels, keeps its momentum,
  slows as it picks up snow (what it collects was standing still) and to
  rolling resistance that grows in deep snow, rolls downhill and off window
  edges, and lags on a window that starts moving, the way a ball on a tray
  does.
- **The snow gives.** It's squeezed to fit under the ball until it's packed
  firm, so the ball sinks into its own print, leaves a smooth, glazed track,
  and kicks loose snow off its front when it moves fast.

Hold a ball to pick it up: it hangs from the pointer on a spring that
softens as it grows, so a big one lags and sags. Let go mid-swing to throw
it. It keeps that speed and spin, falls under gravity, bounces a little
(less in deep snow), and throws up snow where it lands. Throw it hard at a
window, the ground or the side of the screen and it bursts: some of it
sticks there as a splat, the rest flies off in chunks and powder. Balls knock
into each other, and one set gently on top of another stays there, so you
can build a snowman. The plow scoops small balls into its berm and shoves
big ones ahead of it.

Snow only takes the pointer where it's at least 4 px deep, or where there's
a ball. Everywhere else your clicks go to your windows as usual. If the
snow along the bottom gets in the way of clicking, switch **Snowballs** off
in the menu or run `flurry snowballs`.

![Scooping, rolling, lifting, throwing, a splat, and a stack](docs/snowballs.png)

Leaves and petals fall like paper: they swing, tilt, and sink fastest through
the middle of each swing. Resting ones slide to a stop, come off a window that
lurches harder than they can hold, and lift in strong gusts. Snowmen standing
on a window rock on a damped spring when it is dragged.


</details>

<details>
<summary><b>Decorate</b></summary>

Pick **Decorate** in the menu (or `flurry decorate`). A toolbar appears: plant
up to three trees, roll snowmen, then click a tree with the bauble, lights,
candy cane or star tool. **Remove** clears whatever you click. **Done** or
Esc leaves decorate mode. Everything stays where you leave it across
restarts, and a snowman on a window travels with it between workspaces.

The tree is painted in layers: drooping boughs with needle texture and the
shadow each tier casts on the one below, snow lying on the boughs, glass
baubles with a highlight, a window reflection and a gold cap, and a faceted
gold star. Its bulbs breathe rather than blink, each on its own slow rhythm.
They light the needles around them, put small coloured glints in the
baubles beside them, and the star glows with soft rays.

</details>

<details>
<summary><b>Lights on your windows</b></summary>

Pick **Window lights** in the toolbar and click a window: a string of
lights hangs along its top edge. Click again for other colours (warm white,
classic colours, icy blue, candy cane); **Remove** takes it down. Or bind
`flurry lights`, which does the same for the focused window and turns it off
after the last colour.

Lights belong to the app, not the window: every terminal gets them if you
decorate one, and they come back when you open it again. The wire is
simulated: clips hold it every 150 px or so and it hangs in loose swags
between them. Drag the window and the swags trail behind and swing back,
each bulb swinging on its socket. Gusts sway it, and so does a fast pointer
brushing past. Resizing re-spaces the clips. The bulbs throw coloured light
on the window under them, and windows in front hide them like anything else.

![A light string swinging as its window is dragged](docs/window-lights.png)

</details>

<details>
<summary><b>Friends and the little train</b></summary>

1. **Set up friends** in the menu, then **Copy my code** and send it to a friend.
2. Copy their code and press **Add from clipboard** (or `flurry add <code>`).
3. Right-click a snowman or tree, **Send to …**. The train comes for it, and it
   pulls up on your friend's desktop. Notes go the same way.

Gifts travel over [ntfy](https://ntfy.sh): your inbox is a topic named after
128 random bits, so only someone with your code can send to it. Anyone who
has your code can, though, so share it with friends only. To use your own
ntfy server, set `"server"` in `~/.local/state/omarchy-flurry/state.json`.
Incoming gifts are size-checked and validated before anything is drawn.

</details>

<details>
<summary><b>Shake, wind, writing, live weather, icicles, theme and seasons</b></summary>

#### Shake the globe
`flurry shake`, or the **Shake** button in the menu, lifts the settled snow back into the air. Mass is conserved as it lifts. Three slow eddies turn it over, the decorations rock, and it all settles again.

#### Wind from your windows
When you fling a window faster than about 140 px/s, it sheds the snow sitting on top of it. The gust also pushes nearby falling flakes and loose powder. Toggle with `flurry gusts`.

#### Write in the snow
Hold **Ctrl** and drag across the snow to cut a groove with a lit rim. New snow fills it in over time. Writing needs **Snowballs** turned on, since it uses the same touch areas. Toggle with `flurry writing`.

#### Live weather
This is off by default. Turn it on with `flurry city <name>` or `flurry location <lat> <lon>`, and control it with `flurry weather on|off|now`. It reads Open-Meteo every 15 minutes, with no API key. Snowfall, wind direction, wind speed and temperature drive the scene. The last reading is cached for up to 3 hours, and a failed fetch backs off quietly.

#### Day, thaw and icicles
In the warm hours of the day, snow slowly settles and melts. In the cold (with live weather off, a winter night counts as about −4 °C and a winter afternoon as about +1 °C) the windows freeze:

- **Icicles** grow within a minute or two on every window that has snow on top. They hang from the bottom edge when there is room under it (a floating window), and from the top edge, under the snow like eaves, when there isn't: on a tiled desktop the bottom edges sit on the next window or the ground, where nothing would show. Under the snow they stay shorter, so they never cover much of the window. In a thaw they drip a single drop at a time and shrink; a jerk of the window snaps them off, long ones first.
- **Frost** comes in over a minute or so on cold nights and in hard cold: a thin rime along the window's top edge and feathered crystals in its two top corners, each window its own pattern. It fades in the warmth.
- At night the lying snow freezes to a faint glaze that glints.

`flurry freeze` freezes the windows in view at once, whatever the weather or the hour, to check it works (they then follow the weather as usual). Toggle the whole thing with `flurry daycycle` (**Melting, icicles, night glaze** in the menu).

#### Follows your Omarchy theme
Flurry reads `~/.local/state/omarchy/current/theme/colors.toml` and tints the window lights, the snowman's scarf and the snow's shadows to match. It updates live when you switch themes. The light strings also get a **theme** palette. Toggle with `flurry theme`.

#### Seasons
- **New Year:** a quiet 10-second countdown at local midnight on Jan 1, then about 100 seconds of minimal fireworks behind your windows. Preview them with `flurry fireworks [seconds]`. Toggle with `flurry newyear`.
- **Spring:** in the 14 days before Nowruz (the March equinox), the snow stops and thaws, green sprouts come up along the ground, and petals drift down in place of flakes. Spring lasts until Sizdah Bedar. Preview it with `flurry season spring|winter|auto`. Toggle with `flurry seasons`.

</details>

<details>
<summary><b>Little surprises</b></summary>

The first visitor comes within a minute or two after Flurry starts, then one every two to four and a half minutes, never the same one twice running unless it's the only one that can come.

- **A robin** lands on a window ledge (snowy or bare, even one right under the bar), on the plow's roof, or on the ground. It hops, pecks, cocks its head, leaves tiny footprints, and flies off when your cursor comes close, its window moves, or a snowball flies near.
- **A winter hare** (white, with black-tipped ears) comes in from the edge of the screen with a few low hops, then mostly walks the way a hare does when it is in no hurry: the forefeet reach ahead one after the other, then the hind feet come up together under it, leaving a trail of prints in the snow. Now and then it runs a few hops, and between runs it stops to nibble at the snow, sit up tall with its ears raised and its nose twitching, or just sit, an ear flicking back now and then. After half a minute to a minute it heads off the nearer edge. It bolts when your cursor comes close, a snowball lands near it, or the plow comes. Before every plow run the hare comes on purpose, with a robin five seconds behind it (see the snow plow).
- **The golden snowflake**, very rarely. Catching it unlocks a new bauble finish for the tree (`flurry ornaments [style]`).

They come only when it makes sense. The scene's mode is the effect, or with the Snow effect the live weather (`snow`, `flurries`, `blizzard`, `sleet`, `rain`, `clear`; plain `snow` with live weather off), or `spring` once the thaw is well along:

| | snow, flurries | blizzard | clear | sleet, rain | spring | other effects |
|---|---|---|---|---|---|---|
| robin | yes | no | yes | no | yes | no |
| hare | yes, with snow on the ground | no | yes, with snow on the ground | no | brown, once the sprouts are up | no |
| golden flake | yes | yes | no | no | no | no |

The robin also stays away in strong wind (live weather). Nothing comes while calm mode is on, a fullscreen app is up, a window is being dragged, you're decorating, or the battery is low; when nothing can come, Flurry looks again in fifteen seconds rather than waiting out the interval. Switching calm mode on or **Surprises** off sends a robin or hare already here away (it flies off or bolts). Toggle surprises with `flurry surprises`.

`flurry surprise bird|rabbit|golden` brings one now, bypassing the timer and the weather; if the weather would normally keep it away it still comes and the reply says so (for example `rabbit (forced; normally not now: the hare comes only in snow (now rain))`). `cat` is still accepted as the hare's old name. `flurry diag` prints what each one is waiting for (see below).

Click a snowman to dress it one piece at a time: hat, carrot nose, then a scarf in your theme colour. Its outfit is remembered.

![The robin, the hare and a frozen window](docs/critters.png)

</details>

<details>
<summary><b>Throwing to friends, calm mode, and how the snow treats your windows</b></summary>

#### Throw a snowball to a friend
This is opt-in. Pick a friend with `flurry throwto <friend>` and turn it on with `flurry throwing`. Throw a snowball off the edge of your screen faster than about 1150 px/s and it travels over ntfy. It flies in from the matching side of your friend's desktop and bursts on the first thing it hits.

#### Calm, fullscreen and battery
- Flurry pauses while a fullscreen window is active, on the workspace or in an open special workspace (scratchpad). Going fullscreen hides the scene cleanly: nothing keeps falling, sounds stop, and with the anchor plugin the icicles and frost it drew on your windows are taken off too.
- On battery it runs at 30 fps, and below 20% charge at 24 fps.
- `flurry calm on|off|work` turns off surprises and fireworks and softens the snow. With `work`, calm mode applies only during the `workHours` set in `state.json`.

#### How the snow treats your windows
- Falling snow is drawn behind windows and only settles on their top edges. It never covers what's inside a window.
- A window's ledge snow, icicles, lights, snowmen, perched birds and resting snowballs are tied to that window's Hyprland address. When the window closes, they're released straight away: the ledge falls as loose snow with a small puff of dust, and nothing is left floating.
- When a window goes to another workspace or monitor, what lies on it is put aside and comes back with it, a little melted if it was away long. Rain on its top stays wet too. Flurry gives a window 2.5 s before it treats it as gone, so a window that drops out of the window list for a moment during a workspace switch doesn't lose its snow. A window Hyprland says has closed is let go at once. When you unplug a monitor, the snow on its windows moves with them to the screen they land on.
- A window opening next to snowy windows knocks a little loose snow off the ledges near it (within about 160 px): a few clumps and a dusting, never more. Focusing a window does nothing but restack.
- A window behind another keeps collecting snow on the part of its top edge that is covered, out of sight. When the front window moves away, that stretch is as deep as the rest.
- `hyprctl -j clients` decides which windows exist. Flurry checks it every 30 s while a scene shows and after every window event, and ignores any reply that arrived before a window closed. Opening or closing the special workspace re-reads the monitors, so the scratchpad's windows get (and lose) their ledges as it toggles.
- A gentle drag carries the snow. What holds it on is friction plus the bond packed snow forms with the window (together 1.6 g for fresh powder up to 2.6 g for settled snow). A drag that speeds up more gently than that keeps its ledge. Only a long, fast run blows some powder off, and only a sharp drop held for over 70 ms lifts the snow off.
- Yank a window sideways and the snow stays where it was, like plates when a tablecloth is pulled out from under them. Flurry adds up how far the window's change in speed outruns what the snow's grip can pass on. Once that excess passes the speed at which kinetic friction (μk 0.2–0.3) would need more than 16 px to catch the snow up (about 115 px/s), the bond breaks. In practice that means going from rest to about 400–550 px/s within a tenth of a second (less for fresh powder, more for settled snow), or to 1500 px/s within a third of a second. The whole ledge comes loose in the next frame as clumps of a few sizes, each keeping its own place on screen. The window slides out from under them. A clump falls as soon as the window's edge has passed it, so the ledge drops right where it was, a column at a time. Kinetic friction only gives the snow a little of the window's speed (a couple of hundred px/s at most), so none of it is thrown. Pieces tumble, break in two and shed a little powder, and the snow's mass is kept. If the window stops while it is still under some of the snow, that snow settles back onto it. Icicles snap off where they hung, a perched bird takes off, and a snowman riding the window drops to the ground where it stood.
- A window that moves with no pointer dragging it keeps its snow: the snow moves with it and nothing is read as a jolt. That covers a tiling relayout, a workspace switch, a keyboard move, and a window opening, closing, floating or going fullscreen. Hyprland reports no button state while you drag, so a drag is recognised by the pointer instead. It has to be moving, on the window or within a poll's travel of it, going the same way, and no layout event can have fired in the last 0.3 s. The first sample of a drag comes after the idle poll, so its speed is taken over the poll gap plus the 50 ms pointer poll. A long gap is therefore not mistaken for a huge speed, and a real yank is not mistaken for a jump. During an active drag, a big step counts as a yank even if the pointer reading lags.
- The air a moving window stirs up eases in and out.
- The first little surprise shows up 45 to 90 seconds after start, then one every 2 to 4.5 minutes. Icicles form within a minute or two in cold weather.

</details>


## From the terminal

`bin/flurry` wraps the IPC target, handy for Hyprland binds:

```bash
flurry toggle | on | off | next
flurry effect rain
flurry intensity 1.5
flurry decorate | santa | yeti | clear
flurry plow               # call the snow plow now (refused while it's switched off)
flurry plow on|off|toggle # the Snow plow switch
flurry surprise bird      # or rabbit, golden: one now, whatever the timer and weather
flurry freeze             # icicles and frost on the windows in view, now
flurry diag               # what each feature is doing and why
flurry lights             # lights on the focused window, next colours, off
flurry snowballs          # let snow take the pointer, or not
flurry code               # your friend code
flurry add flurry1:…      # or with no argument, from the clipboard
flurry note Ali "Merry Christmas!"
flurry status
flurry update             # omarchy plugin update for Flurry (--yes to skip the question)
```

or directly: `omarchy-shell flurry effect sakura`.

### `flurry diag`

Prints JSON: the scene's mode and the weather it comes from (temperature,
whether measured or from the calendar, season, sun, freeze), the gates
(surprises, calm, fullscreen, decorating, battery, the plow and day-cycle
switches), the surprise scheduler (running or not, seconds to the next try,
the last attempt with what came or why nothing did, recent visitors, and for
the robin, the hare and the golden flake either "can come" or the reason
they can't), the scene (perches a bird could use, ground snow depth and
cover, sprouts, who is on screen, whether the plow is out), the plow's
visitors (`plowArrival`: the timings, the sequence now with its phase and
what comes next, and the last one's steps with their times), the ice
(icicle count, whether they're growing, and per window its snow depth,
icicles, where they hang, frost and glaze), and any feature that failed.

### When something breaks

Each visitor, the ice, the frost, the sprouts, the fireworks, the plow and
the snowballs are stepped and painted separately, each in its own
try/catch. One that throws is dropped for that frame and logged once
(`flurry: rabbit failed: …` in the shell's log, and in `flurry diag`); the
snow and everything else keep going. Each paint also starts from a reset
context, so nothing a failed paint left behind carries into the next.

## Performance

Everything draws on one canvas per screen in batched paths. On battery the
effect is halved and capped at 30 fps (turn that off in the menu), and it
stops while a fullscreen app is up. Hyprland sends no events during an
interactive window drag, so the window list is read over Hyprland's socket
every frame while a drag is under way: from the moment the focused window
moves in the pointer feed (or any window is seen moving) until two seconds
after the last move. The rest of the time Hyprland's window events say when
to read it, and a focus change is a single read. When nothing in a scene
moves (no snow falling, nothing in the air or sliding, no visitor), it stops
its frame loop after a moment and looks in once a second: it reads the
windows, steps the slow things (a thaw, icicles growing) through that second
and paints once. A window event, a drag, the pointer, a switch or a visitor
wakes it at once. Its clock follows real time, so a long frame or an idle
spell never slows the weather down. Nothing runs on a timer while no scene
shows, except the checks that decide whether one should (calm hours, battery,
the New Year countdown, live weather). The
pointer is read for every effect but rain and starfall. The simulation costs
about 0.25 ms a frame on a 2560×1440 screen with six windows at full snow
(measured under node). A terminal with 25 window lights adds about 1.5 ms of
drawing a frame (also under node), and six snowballs about 0.1 ms of
simulation and 2 ms of drawing; a tree's lights repaint
at 30 fps on their own layer and the rest of the tree only when it changes.

## Development

```bash
node --test tests/*.test.js        # simulation, state, wiring and Qt-canvas tests
omarchy plugin validate .
```

The simulation (`lib/sim.js`), drawing (`lib/draw.js`) and state
(`lib/store.js`) are plain JavaScript, so they run under node as well as in the
shell. `tests/render-preview.js` paints every effect to PNG with
`@napi-rs/canvas` for checking the art without a desktop, and
`tests/render-physics.js` renders a filmstrip of a snowy window being flung
and stopped (`docs/physics.png`). `tests/render-plow.js` lets the snow pile
up until the plow comes, then renders its pass and a close-up
(`docs/plow.png`). `tests/render-plow-sequence.js` renders the plow's
arrival (hare, robin 5 s later, lingering, the flight from the plow, the
clearing) as a five-frame strip, seeded. `tests/render-lights.js` renders a decorated tree and a
light string being dragged (`docs/tree.png`, `docs/window-lights.png`).
`tests/render-snowballs.js` scoops, rolls, lifts, throws, bursts and stacks
snowballs (`docs/snowballs.png`). `tests/qtcanvas.js` is a strict stand-in
for Qt's Context2D: it throws wherever Qt does (a negative arc or gradient
radius, a colour stop out of range or unparseable, a non-finite gradient)
and on anything Qt doesn't have (`roundRect`, `filter`, `Path2D`, a
browser-style `ellipse`, `multiply` instead of `qt-multiply`); every painter
runs against it in `tests/critters.test.js`. `tests/wiring.test.js` checks
that every library function the QML calls is imported and defined, that
every `bin/flurry` command reaches an IPC function, and that no QML object
declares a handler twice. `tests/render-critters.js` renders the robin, the
hare and a frozen window (`docs/critters.png`).

| File | What it is |
|---|---|
| `Service.qml` | State, persistence, window and pointer feeds, visitors' schedule, friends inbox, IPC |
| `SceneWindow.qml` | One transparent layer per screen: weather, decorations, Santa, the Yeti, the train |
| `Widget.qml` | The bar icon and its panel (live preview, Scene, World, Friends) |
| `i18n/` | The panel's strings, one JSON catalog per Omarchy language (English, Persian) |
| `Decoration.qml`, `Visitor.qml`, `ContextMenu.qml`, `Toolbar.qml` | Pieces of the scene |

Inspired by KoiArt for macOS and Windows. Flurry is an independent project;
all art is drawn in code.

MIT licensed.
