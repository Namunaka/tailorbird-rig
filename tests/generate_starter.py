"""Rebuild small product-neutral design fixtures for the bundled starter."""
from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[1]/'tailorbird_rig/starter/designs/v1'
manifest=json.loads((root/'coverage.json').read_text())
font=ImageFont.load_default()
for device in manifest['devices']:
    w,h=device['w'],device['h']
    for state in manifest['states']:
        image=Image.new('RGB',(w,h),'#080d16');draw=ImageDraw.Draw(image)
        draw.text((28,30),'TAILORBIRD / RIG',font=font,fill='#75adff')
        draw.text((28,78),state.upper()+' / V1',font=font,fill='white')
        x,y=(w//2,135) if w>=600 else (28,140)
        right=w-28;bottom=min(h-70,y+340)
        draw.rounded_rectangle((x,y,right,bottom),radius=22,fill='#192330',outline='#40546b')
        for i in range(3):
            cy=y+32+i*65
            draw.rounded_rectangle((x+20,cy,right-20,cy+42),radius=10,fill='#27354a')
        draw.rounded_rectangle((x+20,bottom-65,right-20,bottom-20),radius=18,fill='#1478ff')
        draw.text((x+38,bottom-49),'CONTINUE' if state!='done' else 'DONE',font=font,fill='white')
        if w>=600:
            draw.text((30,180),'SPACE FOR YOUR DESIGN',font=font,fill='#b5c9e4')
        target=root/'screens'/device['id']/(state+'.png');target.parent.mkdir(parents=True,exist_ok=True);image.resize((device.get('physicalW',w),device.get('physicalH',h)),Image.Resampling.LANCZOS).save(target)
