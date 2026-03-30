Mediator Resolution — Screenshots and Capture Steps

Place captured screenshots and short video clips in this folder. Use the filenames below so they match references in the proof file and PR.

Filenames (recommended):

- mediator-panel-full.png
- mediator-unauthorized.png
- video-playback-primary.png
- video-playback-fallback.png
- gateway-switch.png
- resolution-presets.png
- resolution-confirm.png
- freighter-connect.png
- freighter-sign.png
- tx-pending.png
- tx-success.png
- tx-error.png
- mediator-panel-mobile.png
- evidence-clip.mp4
- evidence-thumb.png

Quick capture checklist

1. Unauthorized state: open an incognito window (no Freighter) or non-mediator account, load `/mediator/disputes/123`, capture `mediator-unauthorized.png`.
2. Freighter connect: open Freighter, switch to a mediator address, capture `freighter-connect.png` during connect flow.
3. Authorized full panel: after connect, capture full two-column layout `mediator-panel-full.png`.
4. Video primary playback: ensure video plays via Pinata gateway and capture `video-playback-primary.png` showing controls and gateway label.
5. Trigger a playback failure (toggle network throttling or switch gateway) and capture `video-playback-fallback.png` and `gateway-switch.png` showing the manual gateway switch.
6. Resolution flow: select `50/50` or `70/30`, open confirmation modal, capture `resolution-presets.png` and `resolution-confirm.png`.
7. Signing and tx: click resolve, capture the Freighter sign prompt (`freighter-sign.png`), pending state (`tx-pending.png`), and final success (`tx-success.png`) or error (`tx-error.png`).
8. Optional: record a short 10-15s clip of evidence playback as `evidence-clip.mp4`, then extract a thumbnail:

```powershell
ffmpeg -i evidence-clip.mp4 -ss 00:00:02 -vframes 1 evidence-thumb.png
```

Tips

- Use Chrome/Edge DevTools device toolbar for mobile screenshots.
- If encountering CORS issues, use the gateway switch in the UI and re-capture once the fallback loads.
- Keep all files under this folder and reference them in the PR description or `frontend/MEDIATOR_RESOLUTION_PROOF.md` using relative links.
