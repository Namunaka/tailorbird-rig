from tailorbird_rig.lottie_tools import build_animation
from tailorbird_rig.lottie_core import write
from pathlib import Path
parameters = {'name': 'Motion study', 'motion': 'bounce', 'color': '#1478ff', 'duration': 2, 'width': 480, 'height': 360, 'fps': 60}
write(build_animation(**parameters), Path(__file__).with_name("animation.json"))
