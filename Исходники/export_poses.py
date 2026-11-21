import bpy, math
from mathutils import Vector
from pathlib import Path
dest=Path(__file__).resolve().parents[1]/'Ресурсы'
orig=bpy.context.scene
rig=bpy.data.objects['Попов • скелет рассказчика']
c=rig.users_collection[0]
s=bpy.data.scenes.new('Экспорт ключевых поз')
s.collection.children.link(c)
bpy.context.window.scene=s
s.frame_set(1)
for o in c.objects:
    if o.name.startswith('Контакт'): o.hide_render=True
    k=getattr(o.data,'shape_keys',None)
    if k:
        k.animation_data_clear()
        for key in list(k.key_blocks)[1:]:key.value=0
cam=bpy.data.cameras.new('Силуэт'); ob=bpy.data.objects.new('Фронтальный вид',cam);s.collection.objects.link(ob)
ob.location=(rig.location.x,-5,.91);ob.rotation_euler=(math.pi/2,0,0)
cam.type='ORTHO';cam.ortho_scale=1.90;s.camera=ob
s.render.engine='CYCLES';s.cycles.samples=8;s.cycles.use_denoising=False
s.render.film_transparent=True;s.render.image_settings.color_mode='RGBA';s.view_settings.view_transform='Standard'
s.render.resolution_x=640;s.render.resolution_y=1440;s.render.resolution_percentage=100
face = bpy.data.objects['Лицо, корпус, полы сюртука']
inside = bpy.data.objects['Артикуляция • внутренняя поверхность']
emission = next(node for node in inside.active_material.node_tree.nodes if node.type == 'EMISSION')
emission.inputs['Strength'].default_value = .48

# Jaw aperture, rounding, lateral stretch, lower lip against upper incisors.
shapes = {
    'rest': (0, 0, 0, 0),
    'open': (.46, .03, .015, 0),
    'round': (.24, .60, 0, 0),
    'wide': (.16, 0, .32, 0),
    'reduced': (.24, .065, .065, 0),
    'soft': (.12, .015, .06, 0),
    'hush': (.12, .27, .05, 0),
    'teeth': (.055, 0, .045, .54),
    'blink': (0, 0, 0, 0),
    'brow': (0, 0, 0, 0),
}
channels = ('Челюсть', 'Округление губ', 'Растяжение губ', 'Нижняя губа • Ф или В')
for name, weights in shapes.items():
    values = dict(zip(channels, weights))
    if name == 'brow': values['Брови'] = .80
    if name == 'blink': values.update({'Правое веко':1, 'Левое веко':1})
    for part in (face, inside):
        for key in list(part.data.shape_keys.key_blocks)[1:]:
            key.value = values.get(key.name, 0)
    s.render.filepath = str(dest / (name + '.png'))
    bpy.ops.render.render(write_still=True, scene=s.name)
