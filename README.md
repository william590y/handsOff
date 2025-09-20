# Hands-Off Steering Wheel Demo

This is a small static demo that uses MediaPipe Hands to detect the user's hands from the webcam, places a 3D steering wheel model between the palms using Three.js, and graphs two signals in real time with Chart.js:

- r: distance between palm centers (pixels)
- theta: angle of the vector between palms (degrees)

How it works (short):

- MediaPipe reports landmarks for each hand. We compute a simple palm center from wrist and middle_finger_mcp.
- r is the Euclidean distance between the two palm centers in camera pixels.
- theta is atan2(dy, dx). When the hands are level (same y), theta==0 and the wheel is unrotated.
- Wheel scale and rotation are updated each frame; wheel position follows the midpoint between palms.

Model path

The demo expects the GLB model at:

  ../ai-steering-wheel-racing-nrg/source/SteeringWheel_NRG.glb

relative to this `handsOff` folder. If your model is elsewhere, edit `script.js` and change `modelPath`.

Run

Serve the folder with a static server (browsers block camera + module loading on file://):

PowerShell example using Python (if available):

```powershell
python -m http.server 5500
```

Then open http://localhost:5500/ in your browser and allow camera access.

Notes & next steps

- Tuning constants for scale and mapping from pixel to Three.js coordinates may be needed depending on camera, model size, and desired feel.
- Improvements: smoother palm center (temporal), using more reliable palm landmarks, gesture states for grip, and nicer UI.
