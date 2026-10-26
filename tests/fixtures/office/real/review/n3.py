import sys, io, zipfile, re
from pptx import Presentation
from pptx.util import Inches
out = sys.argv[1]
prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = 'Отчёт по клиенту Ястребова П.Г.'
tb = s.shapes.add_textbox(Inches(1), Inches(1.5), Inches(8), Inches(1))
p = tb.text_frame.paragraphs[0]
r = p.add_run(); r.text = 'Написать Ястребовой'
r.hyperlink.address = 'mailto:p.yastrebova@mail.ru?subject=Договор%20Горбунова'
p2 = tb.text_frame.add_paragraph(); r2 = p2.add_run(); r2.text = 'Профиль клиента'
r2.hyperlink.address = 'https://crm.example.ru/clients?fio=Горбунов%20Тимур&inn=770198765434'
mv = s.shapes.add_movie(io.BytesIO(b'\x00\x00\x00\x18ftypmp42' + b'\x00'*200), Inches(1), Inches(3), Inches(3), Inches(2), mime_type='video/mp4')
s.notes_slide.notes_text_frame.text = 'Видео: интервью с Горбуновым Тимуром Ильдаровичем, тел. +7 916 555-12-34'
prs.core_properties.author = 'Ястребова Полина Григорьевна'
buf = io.BytesIO(); prs.save(buf)
zin = zipfile.ZipFile(io.BytesIO(buf.getvalue())); zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    d = zin.read(it.filename)
    if it.filename == 'ppt/slides/slide1.xml':
        x = d.decode()
        x = re.sub(r'(<p:cNvPr id="\d+" name=")([^"]*)("[^>]*?)(/?>)(?=<a:hlinkClick r:id="" action="ppaction://media"/>)', r'\1Интервью Горбунов Т.И.\3 descr="Интервью Горбунов Т.И.mp4"\4', x, count=1)
        # аудио по внешней ссылке
        aud = ('<p:pic><p:nvPicPr><p:cNvPr id="99" name="Звонок Ястребовой" descr="Звонок Ястребовой 12.03.mp3"/><p:cNvPicPr/>'
               '<p:nvPr><a:audioFile r:link="rIdA1"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
               '<p:spPr><a:xfrm><a:off x="6000000" y="3000000"/><a:ext cx="500000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
        x = x.replace('</p:spTree>', aud + '</p:spTree>')
        d = x.encode()
    if it.filename == 'ppt/slides/_rels/slide1.xml.rels':
        x = d.decode()
        img = re.search(r'Id="(rId\d+)" Type="[^"]*/image" Target="([^"]*)"', x)
        x = x.replace('</Relationships>', '<Relationship Id="rIdA1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="file:///C:/Users/yastrebova/Documents/Звонок%20Горбунову%20770198765434.mp3" TargetMode="External"/>'
                      '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + img.group(2) + '"/></Relationships>')
        d = x.encode()
    zout.writestr(it, d)
zout.close()
