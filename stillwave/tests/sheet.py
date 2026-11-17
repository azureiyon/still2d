import sys
from PIL import Image
which=sys.argv[1]
for pre,names in [('lid',['lid-0','lid-0.35','lid-0.7','lid-1']),('mood',['mood-Neutral','mood-Joy','mood-Sleepy','mood-Wink','mood-Surprised'])]:
    ims=[Image.open(f'test-out/{which}-{n}.png') for n in names]
    w=sum(i.width for i in ims); h=ims[0].height
    o=Image.new('RGB',(w,h)); x=0
    for i in ims: o.paste(i,(x,0)); x+=i.width
    o.save(f'test-out/sheet-{which}-{pre}.png')
