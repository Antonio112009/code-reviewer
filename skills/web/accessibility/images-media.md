---
tier: full
name: Images, icons and media
description: Non-text content failures — missing or meaningless alt text, image-only links and buttons without names, unlabeled SVG/icon fonts, untitled iframes, uncaptioned video, autoplaying audio and moving content without pause or reduced-motion support.
priority: 54
tags: [WCAG-1.1.1, WCAG-1.2.2, WCAG-1.4.2, WCAG-2.2.2]
activation:
  content:
    - '<(?:img|svg|video|audio|iframe|canvas|picture|object|Image)\b'
    - '\balt\s*=|\bautoplay\b|\bautoPlay\b|<track\b'
    - '\b(?:carousel|marquee|slider)\b|@keyframes|\bprefers-reduced-motion\b'
  examples:
    - '<img src={avatar} alt="User avatar" />'
    - '<video autoPlay muted src={clip} />'
    - '.carousel { animation: slide 5s infinite; }'
sources:
  - https://www.w3.org/WAI/tutorials/images/decision-tree/
  - https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html
  - https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html
  - https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
---
- **Missing or noise alt**: `<img>`/framework `<Image>` without `alt`, or `alt` set to file names, "image", "photo" or a duplicate of adjacent text → screen readers read the URL or noise. Fix: describe the purpose; `alt=""` for decorative images.
- **Image-only controls**: an image or icon as the only content of a link or button with empty or missing alt → the control has no accessible name. Fix: alt naming the action or destination.
- **SVG and icon fonts**: decorative inline `<svg>` without `aria-hidden="true"` (noise), or meaningful SVG/icon-font glyphs without `role="img"` plus `<title>`/`aria-label` → garbage or nothing announced. Fix: hide decorative, name meaningful.
- **Untitled iframes**: `<iframe>` without `title` → announced only as "frame". Fix: describe the embedded content.
- **Captions and audio**: prerecorded video with speech lacking `<track kind="captions">` (1.2.2); `autoplay` with sound longer than 3 s and no pause/mute (1.4.2) → deaf users excluded, screen readers drowned. Fix: captions; no autoplay with sound.
- **Moving content**: auto-advancing carousels, marquees or animations running longer than 5 s without pause (2.2.2), large motion ignoring `prefers-reduced-motion` → distraction, vestibular symptoms. Fix: pause controls, reduced-motion styles.
