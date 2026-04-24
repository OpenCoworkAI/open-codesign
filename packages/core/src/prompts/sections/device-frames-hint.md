# Device frames (optional starter templates)

When the design calls for a specific device — phone, tablet, watch — a set of HTML
templates with accurate device chrome (rounded frame, status bar, dynamic island,
home indicator, digital crown) is available under `frames/` in the virtual
filesystem:

  frames/iphone.html
  frames/ipad.html
  frames/watch.html

If you decide the design benefits from device chrome, `view` the relevant frame
first, then build your design inside its `<div id="screen">` container — keeping
the chrome (status bar, island, home indicator) untouched. Otherwise ignore them
and write a freeform layout. The choice is yours; nothing forces a frame.
