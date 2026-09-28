# Initial-release decision: silent Reels

Final review decision (2026-09-28): **REMOVE FROM INITIAL RELEASE**. The ten
tracks and audio implementation are preserved in Git commit
`990e8e4764fbe7b6c70e4b397a897c6be0c8d7ac`, not bundled in this candidate.
Production remains on the proven silent `reel-v1` format and fingerprint.
No existing silent-video receipt or asset identity is migrated.

Music may improve polish, but its business benefit has not been demonstrated.
Free CC BY 4.0 music requires attribution, a license link and modification notice.
Incompetech's [Content ID guidance](https://incompetech.com/music/royalty-free/youtube-contentid.html)
warns that video-overlay attribution may not be recognized automatically; retain
description credits and evidence when distributing any future music-enabled Reel.
This guidance concerns YouTube, not a guarantee of Meta account allowlisting.
Automated copyright claims remain possible, and non-publishing tests cannot prove
claim-free Facebook/Instagram publication. Silent Reels avoid this operational
burden, audio validation and approximately 4.8 MB of maintained binary assets.

The following is retained license research for a future separately reviewed
music release, **not a statement that music assets remain installed**.

Verified 2026-09-28, before importing audio. Provider: Kevin MacLeod / Incompetech.
The provider's [licensing page](https://incompetech.com/music/royalty-free/licenses/)
offers its Creative Commons option without charge, with attribution required.
Its [current catalog](https://incompetech.com/music/royalty-free/pieces.json) lists
the titles, source filenames, ISRCs and instrumental instrumentation below.
The current track-page attribution identifies **CC BY 4.0**.

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits commercial use,
adaptation and redistribution, subject to attribution, a license link, indication
of changes and no implication of endorsement. No subscription or paid license is
used. These are original instrumental compositions/recordings, not platform music,
cover songs or unverified third-party reuploads. Catalog instrumentation contains
no voice/vocals. The selected 30-second excerpts are the controlled music assets.

| ID | Title | Instrumentation | Authoritative track/license page |
|---|---|---|---|
| music-01 | Carefree | Ukulele, guitar, marimba, glockenspiel, percussion | [USUAN1400037](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400037) |
| music-02 | Daily Beetle | Ukulele, guitar, marimba, music box, toy piano, drums | [USUAN1500025](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500025) |
| music-03 | Wallpaper | Synths, drum kit, guitar | [USUAN1100843](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100843) |
| music-04 | Cheery Monday | Bass, piano, percussion, glockenspiel | [USUAN1700065](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1700065) |
| music-05 | Wholesome | Cello, viola, marimba, drums | [USUAN1900022](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900022) |
| music-06 | Bright Wish | Piano | [USUAN1100377](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100377) |
| music-07 | Easy Lemon | Guitar, bass, drum kit, celesta, marimba | [USUAN1200076](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1200076) |
| music-08 | Happy Alley | Guitar, bass, drum kit | [USUAN1100482](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100482) |
| music-09 | Lobby Time | Vibraphone, piano, bass, drums | [USUAN1600054](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600054) |
| music-10 | Local Forecast | Piano, bass, drum kit, electric piano, flute, trumpet, percussion, guitar | [USUAN1300010](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300010) |

All ten: author **Kevin MacLeod**, provider **Incompetech**, license **CC BY 4.0**,
commercial use **permitted with attribution**, attribution **required**.
Daily Beetle also credits guitarist **Brett Van Donsel** in the provider's
[release note](https://incompetech.com/wordpress/2015/04/daily-beetle/); its Reel
credit retains that contribution.

Historical controlled location: `media/social-music/`. `library.json` pinned each excerpt's
SHA-256 and source URL. Files are downloaded only during reviewed library import,
not from an arbitrary music URL at render time. They are not part of the public
website package. Do not overwrite an approved track: change the library/template
version intentionally if replacing any audio or attribution.

The removed music-enabled implementation carried its title, author/provider, CC BY 4.0 license URL and
modification notice in a visible credit overlay. Keep that credit when reposting.
The library license does not license product photos or any other site content.
No copyright ownership or endorsement by the musician is claimed. Preserve these
credits/license records with any distribution of the library.

Royalty-free is not a promise of zero automated Content ID claims. Retain this
evidence for review/dispute; never bypass a platform copyright warning. The free
license does not provide a warranty or account-level platform allowlisting.
